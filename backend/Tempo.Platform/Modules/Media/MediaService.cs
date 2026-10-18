using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Media;

public sealed record UploadTicketView(Guid MediaId, Uri UploadUrl, PresignedForm UploadForm, int MaxBytes, string ContentType, DateTimeOffset ExpiresAt);

public sealed record MediaView(Guid Id, string Purpose, Guid OwnerId, int Width, int Height);

/// <summary>
/// Pictures (docs/33 section 6): a class type's cover, the studio's cover, an instructor's photo, a person's avatar.
/// The app asks for an upload ticket, POSTs the file to S3 itself, then finalizes; the API re-encodes it and points
/// the owner at it. Who may set each kind of picture is the same rule that lets them edit its owner.
/// </summary>
public interface IMediaService
{
    Task<UploadTicketView> StartUploadAsync(TenantContext tenant, string? purpose, Guid? ownerId, string? contentType, int? bytes, CancellationToken cancellationToken);

    Task<MediaView> FinalizeAsync(TenantContext tenant, Guid mediaId, CancellationToken cancellationToken);

    /// <summary>Removes the owner's current picture of that purpose; nothing to remove is fine.</summary>
    Task RemoveAsync(TenantContext tenant, string? purpose, Guid? ownerId, CancellationToken cancellationToken);
}

public sealed class MediaService(IDataSourceProvider dataSources, IMediaStore store, TimeProvider clock) : IMediaService
{
    public const int MaxUploadBytes = 8 * 1024 * 1024;
    private static readonly TimeSpan UploadLifetime = TimeSpan.FromMinutes(10);

    /// <summary>Upload tickets one membership may take in an hour: with the POST's size cap, this bounds what a caller can leave in incoming/.</summary>
    public const int UploadsPerHour = 20;
    private static readonly string[] Purposes = ["class_cover", "instructor_photo", "studio_cover", "avatar"];
    private static readonly string[] ContentTypes = ["image/jpeg", "image/png", "image/webp"];

    public async Task<UploadTicketView> StartUploadAsync(TenantContext tenant, string? purpose, Guid? ownerId, string? contentType, int? bytes, CancellationToken cancellationToken)
    {
        if (!store.Available)
        {
            throw UnavailableMediaStore.Unavailable();
        }

        var (kind, owner) = ValidPurpose(purpose, ownerId);
        if (contentType is null || !ContentTypes.Contains(contentType))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "media.type", "Upload a JPEG, PNG or WebP picture.", "contentType");
        }

        if (bytes is not (> 0 and <= MaxUploadBytes))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "media.too_large", "A picture is at most 8 MB.", "bytes");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await CheckOwnerAsync(unitOfWork, tenant, kind, owner, cancellationToken);
        await CheckUploadRateAsync(unitOfWork, tenant, cancellationToken);
        var id = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO media.media_objects (organization_id, id, purpose, owner_id, status, content_type, declared_bytes, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, now(), now())
            """,
            tenant.OrganizationId, id, kind, owner, contentType, bytes.Value, tenant.MembershipId))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
        var key = MediaKeys.Incoming(id);
        return new UploadTicketView(
            id,
            store.PresignPut(key, contentType, UploadLifetime),
            store.PresignPost(key, contentType, MaxUploadBytes, UploadLifetime),
            MaxUploadBytes,
            contentType,
            clock.GetUtcNow().Add(UploadLifetime));
    }

    private static async Task CheckUploadRateAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var count = unitOfWork.Command(
            "SELECT count(*), min(created_at) FROM media.media_objects WHERE organization_id = $1 AND created_by = $2 AND created_at > now() - interval '1 hour'",
            tenant.OrganizationId, tenant.MembershipId);
        await using var reader = await count.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        if (reader.GetInt64(0) < UploadsPerHour)
        {
            return;
        }

        var retryAfter = reader.GetFieldValue<DateTimeOffset>(1).AddHours(1) - DateTimeOffset.UtcNow;
        throw new DomainRuleViolationException(ViolationKind.TooManyRequests, "rate_limited", "Too many uploads. Try again later.")
        {
            RetryAfter = retryAfter > TimeSpan.Zero ? retryAfter : TimeSpan.FromSeconds(1)
        };
    }

    public async Task<MediaView> FinalizeAsync(TenantContext tenant, Guid mediaId, CancellationToken cancellationToken)
    {
        if (!store.Available)
        {
            throw UnavailableMediaStore.Unavailable();
        }

        string kind;
        Guid owner;
        await using (var unitOfWork = await BeginAsync(tenant, cancellationToken))
        {
            await using var read = unitOfWork.Command(
                "SELECT purpose, owner_id, status, created_by FROM media.media_objects WHERE organization_id = $1 AND id = $2",
                tenant.OrganizationId, mediaId);
            await using var reader = await read.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken) || reader.GetGuid(3) != tenant.MembershipId)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "media.not_found", "Upload not found.");
            }

            if (reader.GetString(2) != "pending")
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "media.not_pending", "This upload was already finished.");
            }

            kind = reader.GetString(0);
            owner = reader.GetGuid(1);
        }

        var incoming = MediaKeys.Incoming(mediaId);
        var original = await store.ReadAsync(incoming, MaxUploadBytes, cancellationToken)
            ?? throw new DomainRuleViolationException(ViolationKind.Conflict, "media.not_uploaded", "The file was not uploaded, or it is over 8 MB.");
        var image = ImageProcessor.Process(original);
        if (image is null)
        {
            await SetStatusAsync(tenant, mediaId, "rejected", cancellationToken);
            await store.DeleteAsync([incoming], cancellationToken);
            throw new DomainRuleViolationException(ViolationKind.Validation, "media.not_an_image", "This file is not a picture we can use.", "file");
        }

        await store.WriteAsync(MediaKeys.Large(mediaId), image.Large, "image/webp", cancellationToken);
        await store.WriteAsync(MediaKeys.Small(mediaId), image.Small, "image/webp", cancellationToken);
        await store.DeleteAsync([incoming], cancellationToken);

        Guid? previous;
        await using (var unitOfWork = await BeginAsync(tenant, cancellationToken))
        {
            // The owner check runs again: a role may have changed while the file was uploading.
            await CheckOwnerAsync(unitOfWork, tenant, kind, owner, cancellationToken);
            previous = await PointAsync(unitOfWork, tenant.OrganizationId, kind, owner, mediaId, cancellationToken);
            await using (var ready = unitOfWork.Command(
                "UPDATE media.media_objects SET status = 'ready', width = $3, height = $4, bytes = $5, updated_at = now() WHERE organization_id = $1 AND id = $2",
                tenant.OrganizationId, mediaId, image.Width, image.Height, image.Large.Length))
            {
                await ready.ExecuteNonQueryAsync(cancellationToken);
            }

            if (previous is { } old)
            {
                await MarkDeletedAsync(unitOfWork, tenant.OrganizationId, old, cancellationToken);
            }

            await AuditWriter.WriteAsync(
                unitOfWork,
                new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "media.uploaded", "media", mediaId, tenant.CorrelationId, new { purpose = kind, ownerId = owner }),
                cancellationToken);
            await unitOfWork.CommitAsync(cancellationToken);
        }

        if (previous is { } replaced)
        {
            await store.DeleteAsync([MediaKeys.Large(replaced), MediaKeys.Small(replaced)], cancellationToken);
        }

        return new MediaView(mediaId, kind, owner, image.Width, image.Height);
    }

    public async Task RemoveAsync(TenantContext tenant, string? purpose, Guid? ownerId, CancellationToken cancellationToken)
    {
        var (kind, owner) = ValidPurpose(purpose, ownerId);
        Guid? previous;
        await using (var unitOfWork = await BeginAsync(tenant, cancellationToken))
        {
            await CheckOwnerAsync(unitOfWork, tenant, kind, owner, cancellationToken);
            previous = await PointAsync(unitOfWork, tenant.OrganizationId, kind, owner, null, cancellationToken);
            if (previous is { } old)
            {
                await MarkDeletedAsync(unitOfWork, tenant.OrganizationId, old, cancellationToken);
                await AuditWriter.WriteAsync(
                    unitOfWork,
                    new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "media.removed", "media", old, tenant.CorrelationId, new { purpose = kind, ownerId = owner }),
                    cancellationToken);
            }

            await unitOfWork.CommitAsync(cancellationToken);
        }

        if (previous is { } removed)
        {
            await store.DeleteAsync([MediaKeys.Large(removed), MediaKeys.Small(removed)], cancellationToken);
        }
    }

    /// <summary>
    /// Erase (docs/27): the person's avatar row is marked deleted inside the erase transaction; the caller deletes
    /// the returned keys after commit.
    /// </summary>
    public static async Task<IReadOnlyList<string>> ForgetAvatarAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            UPDATE media.media_objects SET status = 'deleted', updated_at = now()
            WHERE organization_id = $1 AND purpose = 'avatar' AND owner_id = $2 AND status <> 'deleted'
            RETURNING id
            """,
            organizationId, personId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var keys = new List<string>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var id = reader.GetGuid(0);
            keys.Add(MediaKeys.Large(id));
            keys.Add(MediaKeys.Small(id));
        }

        return keys;
    }

    private static (string Kind, Guid Owner) ValidPurpose(string? purpose, Guid? ownerId)
    {
        if (purpose is null || !Purposes.Contains(purpose))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "media.purpose", "Say what the picture is for.", "purpose");
        }

        return (purpose, ownerId ?? throw new DomainRuleViolationException(ViolationKind.Validation, "ownerId.required", "Say whose picture it is.", "ownerId"));
    }

    /// <summary>The same rule that lets the caller edit the picture's owner (docs/33 section 6.3).</summary>
    private static async Task CheckOwnerAsync(UnitOfWork unitOfWork, TenantContext tenant, string kind, Guid owner, CancellationToken cancellationToken)
    {
        bool allowed;
        bool exists;
        switch (kind)
        {
            case "class_cover":
                exists = await ExistsAsync(unitOfWork, "SELECT 1 FROM scheduling.class_types WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, owner, cancellationToken);
                allowed = tenant.Has(Permissions.ScheduleManage);
                break;
            case "studio_cover":
                exists = owner == tenant.OrganizationId;
                allowed = tenant.Has(Permissions.OrganizationSettingsManage);
                break;
            case "instructor_photo":
                exists = await ExistsAsync(unitOfWork, "SELECT 1 FROM organizations.memberships WHERE organization_id = $1 AND id = $2 AND status = 'active' AND role <> 'client'", tenant.OrganizationId, owner, cancellationToken);
                allowed = owner == tenant.MembershipId || tenant.Has(Permissions.ScheduleManage);
                break;
            default:
                exists = await ExistsAsync(unitOfWork, "SELECT 1 FROM people.people WHERE organization_id = $1 AND id = $2 AND status = 'active'", tenant.OrganizationId, owner, cancellationToken);
                allowed = tenant.Has(Permissions.PeopleManage)
                    || await ExistsAsync(unitOfWork, "SELECT 1 FROM people.people WHERE organization_id = $1 AND id = $2 AND membership_id = $3", tenant.OrganizationId, owner, cancellationToken, tenant.MembershipId);
                break;
        }

        if (!exists)
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "media.owner_not_found", "There is nothing to put this picture on.");
        }

        if (!allowed)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You can't change this picture.");
        }
    }

    /// <summary>Points the owner at <paramref name="mediaId"/> (null clears it) and returns the picture it replaced.</summary>
    private static async Task<Guid?> PointAsync(UnitOfWork unitOfWork, Guid organizationId, string kind, Guid owner, Guid? mediaId, CancellationToken cancellationToken)
    {
        var (table, column, key) = kind switch
        {
            "class_cover" => ("scheduling.class_types", "cover_media_id", "id"),
            "studio_cover" => ("organizations.organizations", "cover_media_id", "id"),
            "instructor_photo" => ("organizations.staff_profiles", "photo_media_id", "membership_id"),
            _ => ("people.people", "avatar_media_id", "id")
        };

        if (kind == "instructor_photo")
        {
            await using var ensure = unitOfWork.Command(
                "INSERT INTO organizations.staff_profiles (organization_id, membership_id, updated_at) VALUES ($1, $2, now()) ON CONFLICT DO NOTHING",
                organizationId, owner);
            await ensure.ExecuteNonQueryAsync(cancellationToken);
        }

        var tenantColumn = kind == "studio_cover" ? "id" : "organization_id";
        var ownerFilter = kind == "studio_cover" ? "" : $" AND {key} = $2";
        Guid? previous;
        await using (var read = unitOfWork.Command($"SELECT {column} FROM {table} WHERE {tenantColumn} = $1{ownerFilter} FOR UPDATE", organizationId, owner))
        {
            previous = await read.ExecuteScalarAsync(cancellationToken) as Guid?;
        }

        await using (var update = unitOfWork.Command($"UPDATE {table} SET {column} = $3, updated_at = now() WHERE {tenantColumn} = $1{ownerFilter}", organizationId, owner, mediaId))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        return previous;
    }

    private static async Task MarkDeletedAsync(UnitOfWork unitOfWork, Guid organizationId, Guid mediaId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("UPDATE media.media_objects SET status = 'deleted', updated_at = now() WHERE organization_id = $1 AND id = $2", organizationId, mediaId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task SetStatusAsync(TenantContext tenant, Guid mediaId, string status, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var command = unitOfWork.Command("UPDATE media.media_objects SET status = $3, updated_at = now() WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, mediaId, status))
        {
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
    }

    private static async Task<bool> ExistsAsync(UnitOfWork unitOfWork, string sql, Guid organizationId, Guid id, CancellationToken cancellationToken, Guid? extra = null)
    {
        await using var command = extra is { } e ? unitOfWork.Command(sql, organizationId, id, e) : unitOfWork.Command(sql, organizationId, id);
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}

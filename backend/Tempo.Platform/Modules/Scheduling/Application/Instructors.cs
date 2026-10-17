using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Scheduling.Application;

/// <summary>An instructor as members see them (docs/33 section 5); <paramref name="PhotoMediaId"/> becomes a URL in the API.</summary>
public sealed record InstructorProfileView(
    Guid MembershipId,
    string DisplayName,
    string? Headline,
    string? Bio,
    string? InstagramHandle,
    string? PlaylistUrl,
    Guid? PhotoMediaId,
    bool Visible,
    IReadOnlyList<SessionView> NextSessions);

public sealed record StaffProfileInput(string? Headline, string? Bio, string? InstagramHandle, string? PlaylistUrl, bool? Visible);

/// <summary>Instructor profiles and the instructor's note to a class (docs/33 sections 5 and 7).</summary>
public interface IInstructorService
{
    /// <summary>Visible profiles of active staff who teach (a weekly class or a future session) or wrote a profile.</summary>
    Task<IReadOnlyList<InstructorProfileView>> ListAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<InstructorProfileView> GetAsync(TenantContext tenant, Guid membershipId, CancellationToken cancellationToken);

    /// <summary>The caller's own profile (null <paramref name="membershipId"/>), or anyone's with `schedule.manage`.</summary>
    Task<InstructorProfileView> SaveAsync(TenantContext tenant, Guid? membershipId, StaffProfileInput input, CancellationToken cancellationToken);

    /// <summary>`schedule.manage` or the session's own instructor; <paramref name="applyToWeekly"/> also sets the weekly class's note.</summary>
    Task<SessionView> SetMemberNoteAsync(TenantContext tenant, Guid sessionId, string? note, bool applyToWeekly, CancellationToken cancellationToken);
}

public sealed class InstructorService(IDataSourceProvider dataSources, TimeProvider clock) : IInstructorService
{
    private static readonly string[] PlaylistHosts = ["open.spotify.com", "music.apple.com", "music.youtube.com"];

    private const string ProfileSelect =
        """
        SELECT m.id, coalesce(pe.display_name, ''), sp.headline, sp.bio, sp.instagram_handle, sp.playlist_url, sp.photo_media_id, coalesce(sp.visible, true)
        FROM organizations.memberships m
        LEFT JOIN people.people pe ON pe.organization_id = m.organization_id AND pe.membership_id = m.id
        LEFT JOIN organizations.staff_profiles sp ON sp.organization_id = m.organization_id AND sp.membership_id = m.id
        WHERE m.organization_id = $1 AND m.status = 'active' AND m.role <> 'client'
        """;

    public async Task<IReadOnlyList<InstructorProfileView>> ListAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadAsync(
            unitOfWork,
            tenant.OrganizationId,
            $"""
            {ProfileSelect}
              AND coalesce(sp.visible, true)
              AND (sp.membership_id IS NOT NULL
                   OR EXISTS (SELECT 1 FROM scheduling.templates t WHERE t.organization_id = m.organization_id AND t.instructor_membership_id = m.id
                              AND (t.valid_until IS NULL OR t.valid_until >= current_date))
                   OR EXISTS (SELECT 1 FROM scheduling.sessions s WHERE s.organization_id = m.organization_id AND s.instructor_membership_id = m.id
                              AND s.status = 'scheduled' AND s.starts_at > $2))
            ORDER BY 2, 1
            """,
            cancellationToken,
            clock.GetUtcNow());
    }

    public async Task<InstructorProfileView> GetAsync(TenantContext tenant, Guid membershipId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var profile = (await ReadAsync(unitOfWork, tenant.OrganizationId, $"{ProfileSelect} AND m.id = $2", cancellationToken, membershipId)).SingleOrDefault();
        if (profile is null || (!profile.Visible && !tenant.Has(Permissions.ScheduleManage) && membershipId != tenant.MembershipId))
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "instructor.not_found", "Instructor not found.");
        }

        var next = await TimetableService.SessionsAsync(
            unitOfWork,
            tenant,
            "WHERE s.organization_id = $1 AND s.instructor_membership_id = $3 AND s.status = 'scheduled' AND s.starts_at > $4 ORDER BY s.starts_at LIMIT 5",
            cancellationToken,
            membershipId,
            clock.GetUtcNow());
        return profile with { NextSessions = next };
    }

    public async Task<InstructorProfileView> SaveAsync(TenantContext tenant, Guid? membershipId, StaffProfileInput input, CancellationToken cancellationToken)
    {
        var target = membershipId ?? tenant.MembershipId;
        if (target != tenant.MembershipId && !tenant.Has(Permissions.ScheduleManage))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You can edit only your own profile.");
        }

        var headline = Text(input.Headline, 80, "headline");
        var bio = Text(input.Bio, 600, "bio");
        var instagram = Instagram(input.InstagramHandle);
        var playlist = Playlist(input.PlaylistUrl);
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var staff = unitOfWork.Command(
            "SELECT 1 FROM organizations.memberships WHERE organization_id = $1 AND id = $2 AND status = 'active' AND role <> 'client'",
            tenant.OrganizationId, target))
        {
            if (await staff.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "instructor.not_found", "Only active staff have an instructor profile.");
            }
        }

        await using (var upsert = unitOfWork.Command(
            """
            INSERT INTO organizations.staff_profiles (organization_id, membership_id, headline, bio, instagram_handle, playlist_url, visible, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now())
            ON CONFLICT (organization_id, membership_id) DO UPDATE SET
                headline = EXCLUDED.headline, bio = EXCLUDED.bio, instagram_handle = EXCLUDED.instagram_handle,
                playlist_url = EXCLUDED.playlist_url, visible = EXCLUDED.visible, updated_at = now(),
                version = organizations.staff_profiles.version + 1
            """,
            tenant.OrganizationId, target, headline, bio, instagram, playlist, input.Visible ?? true))
        {
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "staff_profile.updated", "membership", target, tenant.CorrelationId,
                new { headline = headline is not null, bio = bio is not null, instagram = instagram is not null, playlist = playlist is not null, visible = input.Visible ?? true }),
            cancellationToken);
        var saved = (await ReadAsync(unitOfWork, tenant.OrganizationId, $"{ProfileSelect} AND m.id = $2", cancellationToken, target)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return saved;
    }

    public async Task<SessionView> SetMemberNoteAsync(TenantContext tenant, Guid sessionId, string? note, bool applyToWeekly, CancellationToken cancellationToken)
    {
        var text = Text(note, 200, "note");
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        Guid? template;
        await using (var read = unitOfWork.Command(
            "SELECT template_id, instructor_membership_id FROM scheduling.sessions WHERE organization_id = $1 AND id = $2 FOR UPDATE",
            tenant.OrganizationId, sessionId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "session.not_found", "Class not found.");
            }

            template = await reader.IsDBNullAsync(0, cancellationToken) ? null : reader.GetGuid(0);
            var instructor = await reader.IsDBNullAsync(1, cancellationToken) ? (Guid?)null : reader.GetGuid(1);
            if (!tenant.Has(Permissions.ScheduleManage) && instructor != tenant.MembershipId)
            {
                throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Only the class's instructor or a manager can write its note.");
            }
        }

        await using (var update = unitOfWork.Command(
            "UPDATE scheduling.sessions SET member_note = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2",
            tenant.OrganizationId, sessionId, text))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        if (applyToWeekly && template is { } weekly)
        {
            // The weekly class's note, and every future session of it, like a change of instructor (docs/29 4.1).
            await using var templateNote = unitOfWork.Command(
                """
                WITH t AS (UPDATE scheduling.templates SET member_note = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2)
                UPDATE scheduling.sessions SET member_note = $3, updated_at = now(), version = version + 1
                WHERE organization_id = $1 AND template_id = $2 AND starts_at > $4 AND status = 'scheduled'
                """,
                tenant.OrganizationId, weekly, text, clock.GetUtcNow());
            await templateNote.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "session.note_updated", "session", sessionId, tenant.CorrelationId, new { weekly = applyToWeekly && template is not null, cleared = text is null }),
            cancellationToken);
        var session = (await TimetableService.SessionsAsync(unitOfWork, tenant, "WHERE s.organization_id = $1 AND s.id = $3", cancellationToken, sessionId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return session;
    }

    private static async Task<List<InstructorProfileView>> ReadAsync(UnitOfWork unitOfWork, Guid organizationId, string sql, CancellationToken cancellationToken, params object?[] more)
    {
        await using var command = unitOfWork.Command(sql, [organizationId, .. more]);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var profiles = new List<InstructorProfileView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            profiles.Add(new InstructorProfileView(
                reader.GetGuid(0),
                reader.GetString(1),
                await reader.IsDBNullAsync(2, cancellationToken) ? null : reader.GetString(2),
                await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetString(3),
                await reader.IsDBNullAsync(4, cancellationToken) ? null : reader.GetString(4),
                await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetString(5),
                await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetGuid(6),
                reader.GetBoolean(7),
                []));
        }

        return profiles;
    }

    private static string? Text(string? value, int max, string field)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        return text.Length <= max
            ? text
            : throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.too_long", $"At most {max} characters.", field);
    }

    /// <summary>The handle alone: "@dana.pilates", "dana.pilates" and an instagram.com link all become "dana.pilates" (X-6).</summary>
    private static string? Instagram(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        if (Uri.TryCreate(text, UriKind.Absolute, out var url) && url.Host.EndsWith("instagram.com", StringComparison.OrdinalIgnoreCase))
        {
            text = url.AbsolutePath.Trim('/').Split('/')[0];
        }

        text = text.TrimStart('@');
        return text.Length is >= 1 and <= 30 && text.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_')
            ? text
            : throw new DomainRuleViolationException(ViolationKind.Validation, "instagram.invalid", "An Instagram handle has up to 30 letters, digits, dots and underscores.", "instagramHandle");
    }

    /// <summary>Only https links to Spotify, Apple Music or YouTube Music (X-6), so a profile can't carry any other link.</summary>
    private static string? Playlist(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        return text.Length <= 300 && Uri.TryCreate(text, UriKind.Absolute, out var url) && url.Scheme == Uri.UriSchemeHttps
               && PlaylistHosts.Contains(url.Host.ToLowerInvariant()) && string.IsNullOrEmpty(url.UserInfo)
            ? url.AbsoluteUri
            : throw new DomainRuleViolationException(ViolationKind.Validation, "playlist.invalid", "Use a Spotify, Apple Music or YouTube Music link.", "playlistUrl");
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}

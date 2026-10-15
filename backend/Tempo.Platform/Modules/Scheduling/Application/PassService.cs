using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Scheduling.Application;

public sealed record PassProductView(
    Guid Id,
    string Kind,
    string Name,
    int? Entries,
    int ValidDays,
    int? WeeklyCap,
    string? ClassCategory,
    int? PriceAgorot,
    string Status,
    long Version);

public sealed record PassProductRef(Guid Id, string Name, string Kind, int? WeeklyCap, string? ClassCategory);

public sealed record PassView(
    Guid Id,
    Guid PersonId,
    PassProductRef Product,
    DateOnly StartsOn,
    DateOnly EndsOn,
    int? Entries,
    int EntriesUsed,
    string? Note,
    string Status,
    DateTimeOffset CreatedAt,
    long Version)
{
    public int? EntriesLeft => Entries is { } entries ? entries - EntriesUsed : null;
}

public sealed record NewPassProduct(string? Kind, string? Name, int? Entries, int? ValidDays, int? WeeklyCap, string? ClassCategory, int? PriceAgorot);

public sealed record NewPass(Guid ProductId, DateOnly? StartsOn, string? Note);

/// <summary>
/// What a studio sells to its members (docs/29 section 5): punch cards and period memberships, granted by
/// hand at the desk in the skeleton. Route permissions (`passes.view`, `passes.manage`) are checked by the API.
/// </summary>
public interface IPassService
{
    Task<IReadOnlyList<PassProductView>> ListProductsAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<PassProductView> CreateProductAsync(TenantContext tenant, NewPassProduct product, CancellationToken cancellationToken);

    Task<PassProductView> ArchiveProductAsync(TenantContext tenant, Guid productId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PassView>> ListForPersonAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PassView>> ListMineAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<PassView> GrantAsync(TenantContext tenant, Guid personId, NewPass pass, CancellationToken cancellationToken);

    Task<PassView> VoidAsync(TenantContext tenant, Guid passId, CancellationToken cancellationToken);
}

public sealed class PassService(IDataSourceProvider dataSources, TimeProvider clock) : IPassService
{
    private const string ProductColumns = "id, kind, name, entries, valid_days, weekly_cap, class_category, price_agorot, status, version";

    // $1 organization, $2 today in the studio's time zone (for the computed `expired`).
    private const string PassSelect =
        """
        SELECT ps.id, ps.person_id, pp.id, pp.name, pp.kind, pp.weekly_cap, pp.class_category,
               ps.starts_on, ps.ends_on, ps.entries, ps.entries_used, ps.note,
               CASE WHEN ps.status = 'voided' THEN 'voided' WHEN ps.ends_on < $2 THEN 'expired' ELSE 'active' END,
               ps.created_at, ps.version
        FROM scheduling.passes ps
        JOIN scheduling.pass_products pp ON pp.organization_id = ps.organization_id AND pp.id = ps.product_id
        """;

    public async Task<IReadOnlyList<PassProductView>> ListProductsAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command($"SELECT {ProductColumns} FROM scheduling.pass_products WHERE organization_id = $1 ORDER BY status, name", tenant.OrganizationId);
        return await ReadProductsAsync(command, cancellationToken);
    }

    public async Task<PassProductView> CreateProductAsync(TenantContext tenant, NewPassProduct product, CancellationToken cancellationToken)
    {
        var kind = product.Kind is "punch_card" or "membership" ? product.Kind : throw Invalid("kind", "Use punch_card or membership.");
        var name = product.Name?.Trim() is { Length: >= 1 and <= 80 } n ? n : throw Invalid("name", "Use 1 to 80 characters.");
        var validDays = product.ValidDays is >= 1 and <= 730 ? product.ValidDays.Value : throw Invalid("validDays", "Use 1 to 730 days.");
        int? entries = null;
        int? weeklyCap = null;
        if (kind == "punch_card")
        {
            entries = product.Entries is >= 1 and <= 200 ? product.Entries : throw Invalid("entries", "A punch card holds 1 to 200 entries.");
            if (product.WeeklyCap is not null)
            {
                throw Invalid("weeklyCap", "A weekly cap is for memberships only.");
            }
        }
        else
        {
            if (product.Entries is not null)
            {
                throw Invalid("entries", "Entries are for punch cards only.");
            }

            weeklyCap = product.WeeklyCap is null or (>= 1 and <= 14) ? product.WeeklyCap : throw Invalid("weeklyCap", "Use 1 to 14 classes a week, or none.");
        }

        var category = product.ClassCategory is null || System.Text.RegularExpressions.Regex.IsMatch(product.ClassCategory, "^[a-z][a-z0-9_]{1,29}$")
            ? product.ClassCategory
            : throw Invalid("classCategory", "Use a class category, e.g. pilates.");
        var price = product.PriceAgorot is null or >= 0 ? product.PriceAgorot : throw Invalid("priceAgorot", "A price cannot be negative.");
        var id = Guid.CreateVersion7();

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command(
            $"""
            INSERT INTO scheduling.pass_products (organization_id, id, kind, name, entries, valid_days, weekly_cap, class_category, price_agorot, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', now(), now())
            RETURNING {ProductColumns}
            """,
            tenant.OrganizationId, id, kind, name, entries, validDays, weeklyCap, category, price);
        var created = (await ReadProductsAsync(command, cancellationToken)).Single();
        await AuditAsync(unitOfWork, tenant, "pass_product.created", "pass_product", id, new { kind, entries, validDays, weeklyCap }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return created;
    }

    public async Task<PassProductView> ArchiveProductAsync(TenantContext tenant, Guid productId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var command = unitOfWork.Command(
            $"UPDATE scheduling.pass_products SET status = 'archived', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2 RETURNING {ProductColumns}",
            tenant.OrganizationId, productId);
        var archived = (await ReadProductsAsync(command, cancellationToken)).SingleOrDefault()
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "pass_product.not_found", "Product not found.");
        await AuditAsync(unitOfWork, tenant, "pass_product.archived", "pass_product", productId, new { }, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return archived;
    }

    public async Task<IReadOnlyList<PassView>> ListForPersonAsync(TenantContext tenant, Guid personId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await PersonExistsAsync(unitOfWork, tenant.OrganizationId, personId, cancellationToken);
        return await PassesAsync(unitOfWork, tenant.OrganizationId, "WHERE ps.organization_id = $1 AND ps.person_id = $3 ORDER BY ps.created_at DESC", cancellationToken, personId);
    }

    public async Task<IReadOnlyList<PassView>> ListMineAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await PassesAsync(
            unitOfWork,
            tenant.OrganizationId,
            "WHERE ps.organization_id = $1 AND ps.person_id = (SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $3) ORDER BY ps.created_at DESC",
            cancellationToken,
            tenant.MembershipId);
    }

    public async Task<PassView> GrantAsync(TenantContext tenant, Guid personId, NewPass pass, CancellationToken cancellationToken)
    {
        var note = pass.Note?.Trim() switch
        {
            null or "" => null,
            { Length: > 200 } => throw Invalid("note", "Use up to 200 characters."),
            var n => n
        };
        var id = Guid.CreateVersion7();

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var person = unitOfWork.Command("SELECT status FROM people.people WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, personId))
        {
            var status = await person.ExecuteScalarAsync(cancellationToken) as string
                ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "Person not found.");
            if (status is not "active")
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "person.read_only", "Grant passes to active people only.");
            }
        }

        var product = await ProductAsync(unitOfWork, tenant.OrganizationId, pass.ProductId, cancellationToken);
        if (product.Status != "active")
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "pass_product.archived", "This product is no longer sold.");
        }

        var startsOn = pass.StartsOn ?? await TodayAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, entries, note, status, granted_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, now(), now())
            """,
            tenant.OrganizationId, id, personId, product.Id, startsOn, startsOn.AddDays(product.ValidDays - 1), product.Entries, note, tenant.MembershipId))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditAsync(unitOfWork, tenant, "pass.granted", "pass", id, new { personId, productId = product.Id }, cancellationToken);
        var granted = (await PassesAsync(unitOfWork, tenant.OrganizationId, "WHERE ps.organization_id = $1 AND ps.id = $3", cancellationToken, id)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return granted;
    }

    public async Task<PassView> VoidAsync(TenantContext tenant, Guid passId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var update = unitOfWork.Command(
            "UPDATE scheduling.passes SET status = 'voided', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2 AND status = 'active'",
            tenant.OrganizationId, passId))
        {
            if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                var exists = (await PassesAsync(unitOfWork, tenant.OrganizationId, "WHERE ps.organization_id = $1 AND ps.id = $3", cancellationToken, passId)).Count > 0;
                throw exists
                    ? new DomainRuleViolationException(ViolationKind.Conflict, "pass.voided", "This pass is already void.")
                    : new DomainRuleViolationException(ViolationKind.NotFound, "pass.not_found", "Pass not found.");
            }
        }

        await AuditAsync(unitOfWork, tenant, "pass.voided", "pass", passId, new { }, cancellationToken);
        var voided = (await PassesAsync(unitOfWork, tenant.OrganizationId, "WHERE ps.organization_id = $1 AND ps.id = $3", cancellationToken, passId)).Single();
        await unitOfWork.CommitAsync(cancellationToken);
        return voided;
    }

    private async Task<DateOnly> TodayAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
    }

    private async Task<IReadOnlyList<PassView>> PassesAsync(UnitOfWork unitOfWork, Guid organizationId, string where, CancellationToken cancellationToken, params object?[] more)
    {
        var today = await TodayAsync(unitOfWork, organizationId, cancellationToken);
        await using var command = unitOfWork.Command($"{PassSelect} {where}", [organizationId, today, .. more]);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var passes = new List<PassView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            passes.Add(new PassView(
                reader.GetGuid(0),
                reader.GetGuid(1),
                new PassProductRef(
                    reader.GetGuid(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetInt32(5),
                    await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetString(6)),
                await reader.GetFieldValueAsync<DateOnly>(7, cancellationToken),
                await reader.GetFieldValueAsync<DateOnly>(8, cancellationToken),
                await reader.IsDBNullAsync(9, cancellationToken) ? null : reader.GetInt32(9),
                reader.GetInt32(10),
                await reader.IsDBNullAsync(11, cancellationToken) ? null : reader.GetString(11),
                reader.GetString(12),
                await reader.GetFieldValueAsync<DateTimeOffset>(13, cancellationToken),
                reader.GetInt64(14)));
        }

        return passes;
    }

    private static async Task<PassProductView> ProductAsync(UnitOfWork unitOfWork, Guid organizationId, Guid productId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command($"SELECT {ProductColumns} FROM scheduling.pass_products WHERE organization_id = $1 AND id = $2", organizationId, productId);
        return (await ReadProductsAsync(command, cancellationToken)).SingleOrDefault()
            ?? throw new DomainRuleViolationException(ViolationKind.Validation, "pass_product.invalid", "Choose one of the studio's products.", "productId");
    }

    private static async Task PersonExistsAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT 1 FROM people.people WHERE organization_id = $1 AND id = $2", organizationId, personId);
        if (await command.ExecuteScalarAsync(cancellationToken) is null)
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "Person not found.");
        }
    }

    private static async Task<List<PassProductView>> ReadProductsAsync(NpgsqlCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var products = new List<PassProductView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            products.Add(new PassProductView(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                await reader.IsDBNullAsync(3, cancellationToken) ? null : reader.GetInt32(3),
                reader.GetInt32(4),
                await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetInt32(5),
                await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetString(6),
                await reader.IsDBNullAsync(7, cancellationToken) ? null : reader.GetInt32(7),
                reader.GetString(8),
                reader.GetInt64(9)));
        }

        return products;
    }

    private static DomainRuleViolationException Invalid(string field, string message) =>
        new(ViolationKind.Validation, $"{field}.invalid", message, field);

    private static Task AuditAsync(UnitOfWork unitOfWork, TenantContext tenant, string action, string targetType, Guid targetId, object data, CancellationToken cancellationToken) =>
        AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, action, targetType, targetId, tenant.CorrelationId, data),
            cancellationToken);

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}

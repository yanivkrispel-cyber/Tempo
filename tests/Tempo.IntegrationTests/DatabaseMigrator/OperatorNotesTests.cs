using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.PlatformAdmin;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Q11 low findings (#124) on PostgreSQL 18: an operator's free text stays out of the studio's audit log, a
/// suspend that changes nothing is still audited as a view, and the self-clause policies are read-only.
/// </summary>
public sealed class OperatorNotesTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private static readonly OperatorContext Operator = new(Guid.CreateVersion7(), "kris@example.com", "c-op");

    [Fact]
    public async Task Suspend_KeepsTheReasonInTheOperatorsNotes_AndTheStudioAuditLogHoldsOnlyItsId()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var studio = await StudioAsync(db);
        var platform = new PlatformService(db);

        await platform.SetStatusAsync(Operator, studio, OrganizationStatus.Suspended, "Chargeback on the September invoice", CancellationToken.None);
        await platform.SetStatusAsync(Operator, studio, OrganizationStatus.Suspended, "Chargeback on the September invoice", CancellationToken.None);

        (await db.AsMasterAsync("SELECT string_agg(data::text, ' ') FROM audit.audit_events WHERE organization_id = $1", studio) as string)
            .Should().NotContain("Chargeback", "owners and admins read the studio's audit log");
        (await db.AsMasterAsync("SELECT reason FROM platform_admin.operator_notes WHERE organization_id = $1 AND action = 'organization.suspended'", studio))
            .Should().Be("Chargeback on the September invoice");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE organization_id = $1 AND action = 'organization.viewed_by_operator'", studio))
            .Should().Be(1L, "the suspend that changed nothing still showed the operator the studio");
    }

    [Fact]
    public async Task TheSelfClausePolicies_AreReadOnly_AndWritesNeedTheTenant()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);

        var policies = await db.AsMasterAsync(
            """
            SELECT string_agg(tablename || ':' || policyname || ':' || cmd, ',' ORDER BY tablename, policyname)
            FROM pg_policies
            WHERE schemaname IN ('authz', 'organizations') AND tablename IN ('role_assignments', 'ownership_transfers') AND policyname LIKE '%_app%'
            """) as string;

        policies.Should().Be(
            "ownership_transfers:ownership_transfers_app_delete:DELETE,ownership_transfers:ownership_transfers_app_insert:INSERT,"
            + "ownership_transfers:ownership_transfers_app_select:SELECT,ownership_transfers:ownership_transfers_app_update:UPDATE,"
            + "role_assignments:role_assignments_app_delete:DELETE,role_assignments:role_assignments_app_insert:INSERT,"
            + "role_assignments:role_assignments_app_select:SELECT,role_assignments:role_assignments_app_update:UPDATE");
        (await db.AsMasterAsync("SELECT count(*) FROM pg_policies WHERE policyname IN ('role_assignments_app', 'ownership_transfers_app')")).Should().Be(0L, "no FOR ALL policy with a self clause is left");
    }

    private static async Task<Guid> StudioAsync(MigratedDatabase db)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', 'owner@example.com', true, now(), now(), now())",
            id);
        var studio = await new OrganizationService(db).CreateAsync(new AccountSnapshot(id, AccountStatus.Active, true), new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        return studio.Id;
    }
}

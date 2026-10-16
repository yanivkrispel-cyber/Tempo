using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Invitations, the join link and the attempt limit (docs/26 sections 5 and
/// 10.3) against PostgreSQL 18 as `tempo_app`.
/// </summary>
public sealed class InvitationServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    [Fact]
    public async Task Invitation_RoundTrip_PreviewAcceptAndAcceptAgain()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, studioId) = await StudioAsync(db);
        var service = Invitations(db);
        var invitee = await AccountAsync(db, "Staff@Example.com");

        var created = await service.CreateAsync(owner, "staff@example.com", MembershipRole.Staff, CancellationToken.None);
        var preview = await service.PreviewAsync(invitee, created.Token, CancellationToken.None);
        var accepted = await service.AcceptAsync(invitee, created.Token, "c", CancellationToken.None);
        var again = await service.AcceptAsync(invitee, created.Token, "c", CancellationToken.None);

        created.Token.Length.Should().BeGreaterThanOrEqualTo(40);
        (await db.AsMasterAsync("SELECT count(*) FROM organizations.invitations WHERE token_hash = convert_to($1, 'UTF8')", created.Token))
            .Should().Be(0L, "only the hash is stored");
        preview.OrganizationId.Should().Be(studioId);
        preview.Role.Should().Be(MembershipRole.Staff);
        preview.InvitedByDisplayName.Should().Be("Owner");
        accepted.Role.Should().Be(MembershipRole.Staff);
        accepted.Status.Should().Be(MembershipStatus.Active);
        again.MembershipId.Should().Be(accepted.MembershipId, "accepting twice is idempotent");
        (await db.AsMasterAsync("SELECT status FROM organizations.invitations WHERE id = $1", created.Invitation.Id)).Should().Be("accepted");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action IN ('invitation.created', 'invitation.accepted', 'membership.created') AND organization_id = $1", studioId))
            .Should().Be(4L, "the owner's membership.created plus the three invitation events");
    }

    [Fact]
    public async Task Invitation_ForAnotherEmail_IsRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, _) = await StudioAsync(db);
        var service = Invitations(db);
        var stranger = await AccountAsync(db, "stranger@example.com");
        var created = await service.CreateAsync(owner, "staff@example.com", MembershipRole.Staff, CancellationToken.None);

        var accept = () => service.AcceptAsync(stranger, created.Token, "c", CancellationToken.None);

        (await accept.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.email_mismatch");
    }

    [Fact]
    public async Task Invitation_Expired_PreviewsAsNotFound_AndAcceptsAsGone()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, _) = await StudioAsync(db);
        var service = Invitations(db);
        var invitee = await AccountAsync(db, "staff@example.com");
        var created = await service.CreateAsync(owner, "staff@example.com", MembershipRole.Client, CancellationToken.None);
        await db.AsMasterAsync("UPDATE organizations.invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", created.Invitation.Id);

        var preview = () => service.PreviewAsync(invitee, created.Token, CancellationToken.None);
        var accept = () => service.AcceptAsync(invitee, created.Token, "c", CancellationToken.None);

        (await preview.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.not_found");
        (await accept.Should().ThrowAsync<DomainRuleViolationException>()).Which.Kind.Should().Be(ViolationKind.Gone);
        var listed = await service.ListAsync(owner, new InvitationQuery(InvitationStatus.Expired, null, 50), CancellationToken.None);
        listed.Items.Should().ContainSingle().Which.Status.Should().Be(InvitationStatus.Expired);
    }

    [Fact]
    public async Task Invitation_NewOneReplacesThePending_AndRevokedTokensStopWorking()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, _) = await StudioAsync(db);
        var service = Invitations(db);
        var invitee = await AccountAsync(db, "staff@example.com");
        var first = await service.CreateAsync(owner, "staff@example.com", MembershipRole.Client, CancellationToken.None);
        var second = await service.CreateAsync(owner, "STAFF@example.com", MembershipRole.Staff, CancellationToken.None);

        var oldToken = () => service.AcceptAsync(invitee, first.Token, "c", CancellationToken.None);
        (await oldToken.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.not_found");

        await service.RevokeAsync(owner, second.Invitation.Id, CancellationToken.None);
        var revoked = () => service.AcceptAsync(invitee, second.Token, "c", CancellationToken.None);
        (await revoked.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.not_found");
    }

    [Fact]
    public async Task Invitation_AdminsCannotInviteAdmins_AndStaffCannotInvite()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, studioId) = await StudioAsync(db);
        var admin = await MemberAsync(db, studioId, "admin@example.com", MembershipRole.Admin);
        var staff = await MemberAsync(db, studioId, "staff@example.com", MembershipRole.Staff);
        var service = Invitations(db);

        var adminInvitesAdmin = () => service.CreateAsync(admin, "x@example.com", MembershipRole.Admin, CancellationToken.None);
        var staffInvites = () => service.CreateAsync(staff, "y@example.com", MembershipRole.Client, CancellationToken.None);

        (await adminInvitesAdmin.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
        (await staffInvites.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("permission.denied");
        (await service.CreateAsync(admin, "client@example.com", MembershipRole.Client, CancellationToken.None)).Invitation.Role.Should().Be(MembershipRole.Client);
    }

    [Fact]
    public async Task JoinLink_JoinsAsClient_RotationKillsTheOldCode_AndDisableStopsIt()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, studioId) = await StudioAsync(db);
        var links = JoinLinks(db);
        var client = await AccountAsync(db, "client@example.com");
        var late = await AccountAsync(db, "late@example.com");

        var code = await links.RotateAsync(owner, CancellationToken.None);
        (await links.PreviewAsync(client, code, CancellationToken.None)).OrganizationId.Should().Be(studioId);
        var joined = await links.JoinAsync(client, code, "c", CancellationToken.None);
        var twice = await links.JoinAsync(client, code, "c", CancellationToken.None);

        joined.Role.Should().Be(MembershipRole.Client);
        twice.MembershipId.Should().Be(joined.MembershipId);

        var newCode = await links.RotateAsync(owner, CancellationToken.None);
        var withOld = () => links.JoinAsync(late, code, "c", CancellationToken.None);
        (await withOld.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("join.not_found");

        await links.DisableAsync(owner, CancellationToken.None);
        var afterDisable = () => links.PreviewAsync(late, newCode, CancellationToken.None);
        (await afterDisable.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("join.not_found");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action LIKE 'join_link.%' OR action = 'membership.joined_via_link'"))
            .Should().Be(4L);
    }

    [Fact]
    public async Task JoinLink_OfASuspendedStudio_IsRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, studioId) = await StudioAsync(db);
        var links = JoinLinks(db);
        var client = await AccountAsync(db, "client@example.com");
        var code = await links.RotateAsync(owner, CancellationToken.None);
        await db.AsMasterAsync("UPDATE organizations.organizations SET status = 'suspended' WHERE id = $1", studioId);

        var preview = () => links.PreviewAsync(client, code, CancellationToken.None);
        var join = () => links.JoinAsync(client, code, "c", CancellationToken.None);

        (await preview.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("join.not_found");
        (await join.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("organization.suspended");
    }

    [Fact]
    public async Task Attempts_AreLimitedToTwentyAnHour_EvenWhenTheyFail()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var links = JoinLinks(db);
        var prober = await AccountAsync(db, "prober@example.com");

        for (var i = 0; i < AttemptLimiter.PerHour; i++)
        {
            var guess = () => links.PreviewAsync(prober, $"guess-{i:D4}-xxxxxxxxxx", CancellationToken.None);
            (await guess.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("join.not_found");
        }

        var over = () => links.PreviewAsync(prober, "guess-over-xxxxxxxxxx", CancellationToken.None);
        var limited = (await over.Should().ThrowAsync<DomainRuleViolationException>()).Which;
        limited.Kind.Should().Be(ViolationKind.TooManyRequests);
        limited.RetryAfter.Should().BeGreaterThan(TimeSpan.Zero).And.BeLessThanOrEqualTo(TimeSpan.FromHours(1));
    }

    [Fact]
    public async Task Invitation_OfARemovedInviter_IsRevokedAndCannotBeAccepted()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, studioId) = await StudioAsync(db);
        var admin = await MemberAsync(db, studioId, "admin@example.com", MembershipRole.Admin);
        var service = Invitations(db);
        var second = await AccountAsync(db, "admin-second@example.com");
        var created = await service.CreateAsync(admin, "admin-second@example.com", MembershipRole.Staff, CancellationToken.None);

        await Members(db).RemoveAsync(owner, admin.MembershipId, CancellationToken.None);

        var accept = () => service.AcceptAsync(second, created.Token, "c", CancellationToken.None);
        (await accept.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.not_found");
        (await db.AsMasterAsync("SELECT status FROM organizations.invitations WHERE id = $1", created.Invitation.Id)).Should().Be("revoked");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'invitation.revoked' AND target_id = $1 AND data->>'reason' = 'inviter_removed'", created.Invitation.Id))
            .Should().Be(1L);
        (await db.AsMasterAsync("SELECT count(*) FROM organizations.memberships WHERE organization_id = $1 AND user_account_id = $2", studioId, second.UserAccountId))
            .Should().Be(0L);
    }

    [Fact]
    public async Task Invitation_OfADemotedInviter_IsRevoked_OnlyForRolesTheNewRoleCannotInvite()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, studioId) = await StudioAsync(db);
        var admin = await MemberAsync(db, studioId, "admin@example.com", MembershipRole.Admin);
        var service = Invitations(db);
        var staffInvite = await service.CreateAsync(admin, "new-staff@example.com", MembershipRole.Staff, CancellationToken.None);
        var ownersAdminInvite = await service.CreateAsync(owner, "new-admin@example.com", MembershipRole.Admin, CancellationToken.None);

        await Members(db).UpdateAsync(owner, admin.MembershipId, MembershipRole.Client, null, null, CancellationToken.None);

        (await db.AsMasterAsync("SELECT status FROM organizations.invitations WHERE id = $1", staffInvite.Invitation.Id)).Should().Be("revoked");
        (await db.AsMasterAsync("SELECT status FROM organizations.invitations WHERE id = $1", ownersAdminInvite.Invitation.Id))
            .Should().Be("pending", "the owner's own invitations are untouched");
        var stranger = await AccountAsync(db, "new-staff@example.com");
        var preview = () => service.PreviewAsync(stranger, staffInvite.Token, CancellationToken.None);
        (await preview.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.not_found");
    }

    [Fact]
    public async Task Invitation_OfASuspendedInviter_IsRevoked_AndStaysRevokedAfterReactivation()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, studioId) = await StudioAsync(db);
        var admin = await MemberAsync(db, studioId, "admin@example.com", MembershipRole.Admin);
        var service = Invitations(db);
        var invitee = await AccountAsync(db, "client@example.com");
        var created = await service.CreateAsync(admin, "client@example.com", MembershipRole.Client, CancellationToken.None);

        await Members(db).UpdateAsync(owner, admin.MembershipId, null, MembershipStatus.Suspended, null, CancellationToken.None);
        await Members(db).UpdateAsync(owner, admin.MembershipId, null, MembershipStatus.Active, null, CancellationToken.None);

        var accept = () => service.AcceptAsync(invitee, created.Token, "c", CancellationToken.None);
        (await accept.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.not_found");
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'invitation.revoked' AND target_id = $1 AND data->>'reason' = 'inviter_suspended'", created.Invitation.Id))
            .Should().Be(1L);
    }

    [Fact]
    public async Task Invitation_WhoseInviterLostTheRightWithoutRevocation_IsRefusedOnAccept()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, studioId) = await StudioAsync(db);
        var admin = await MemberAsync(db, studioId, "admin@example.com", MembershipRole.Admin);
        var service = Invitations(db);
        var invitee = await AccountAsync(db, "staff@example.com");
        var created = await service.CreateAsync(admin, "staff@example.com", MembershipRole.Staff, CancellationToken.None);

        // A path that changes the role without going through MemberService (an older row, a future code path).
        await db.AsMasterAsync("UPDATE organizations.memberships SET role = 'staff' WHERE id = $1", admin.MembershipId);

        var accept = () => service.AcceptAsync(invitee, created.Token, "c", CancellationToken.None);
        (await accept.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.not_found");
    }

    [Fact]
    public async Task Accept_WaitsForAConcurrentDemotionOfTheInviter_AndIsThenRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (_, studioId) = await StudioAsync(db);
        var admin = await MemberAsync(db, studioId, "admin@example.com", MembershipRole.Admin);
        var service = Invitations(db);
        var invitee = await AccountAsync(db, "staff@example.com");
        var created = await service.CreateAsync(admin, "staff@example.com", MembershipRole.Staff, CancellationToken.None);

        // #137: the inviter loses the right in a transaction that has not committed yet.
        await using var demotion = postgres.ConnectAsMaster(db.Name);
        await demotion.OpenAsync();
        await using var transaction = await demotion.BeginTransactionAsync();
        await using (var demote = new Npgsql.NpgsqlCommand("UPDATE organizations.memberships SET role = 'staff' WHERE id = $1", demotion, transaction))
        {
            demote.Parameters.Add(new Npgsql.NpgsqlParameter { Value = admin.MembershipId });
            await demote.ExecuteNonQueryAsync();
        }

        var accept = Task.Run(() => service.AcceptAsync(invitee, created.Token, "c", CancellationToken.None));
        await Task.Delay(TimeSpan.FromSeconds(1));
        accept.IsCompleted.Should().BeFalse("the accept waits on the inviter's membership row instead of reading the old role");

        await transaction.CommitAsync();
        var refused = () => accept;
        (await refused.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("invitation.not_found");
    }

    private static InvitationService Invitations(MigratedDatabase db) => new(db, new AccountProfiles(db), new AttemptLimiter(db));

    private static MemberService Members(MigratedDatabase db) => new(db, new AccountProfiles(db));

    private static JoinLinkService JoinLinks(MigratedDatabase db) => new(db, new AttemptLimiter(db));

    private static async Task<(TenantContext Owner, Guid StudioId)> StudioAsync(MigratedDatabase db)
    {
        var owner = await AccountAsync(db, "owner@example.com", "Owner");
        var studio = await new OrganizationService(db).CreateAsync(owner, new NewOrganization("Main", "studio-main", null, null), "c", CancellationToken.None);
        var membership = await new MembershipDirectory(db).FindAsync(owner.UserAccountId, studio.Id, CancellationToken.None);
        return (new TenantContext(studio.Id, owner.UserAccountId, membership!.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test"), studio.Id);
    }

    private static async Task<TenantContext> MemberAsync(MigratedDatabase db, Guid studioId, string email, MembershipRole role)
    {
        var account = await AccountAsync(db, email);
        var membershipId = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            studioId,
            membershipId,
            account.UserAccountId,
            StoredValue.Of(role));
        return new TenantContext(studioId, account.UserAccountId, membershipId, role, OrganizationStatus.Active, "test");
    }

    private static async Task<AccountSnapshot> AccountAsync(MigratedDatabase db, string email, string? displayName = null)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, display_name, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, $3, now(), now(), now())",
            id,
            email,
            displayName);
        return new AccountSnapshot(id, AccountStatus.Active, true);
    }
}

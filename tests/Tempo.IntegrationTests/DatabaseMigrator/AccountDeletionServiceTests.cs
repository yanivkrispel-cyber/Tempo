using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Identity.Infrastructure;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// A person deletes their own login (docs/32 section 9, A-1 and A-2) on PostgreSQL 18 as `tempo_app`: the sole owner
/// is refused, and otherwise the account goes while each studio keeps the person record and its history.
/// </summary>
public sealed class AccountDeletionServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string Issuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    [Fact]
    public async Task TheSoleOwner_Gets409WithTheStudio_AndNothingChanges()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (owner, ownerSignIn) = await AccountAsync(db, "owner");
        var studio = await StudioAsync(db, owner, "main");

        var delete = () => new AccountDeletionService(db).DeleteMineAsync(ownerSignIn, "OWNER@example.com ", CancellationToken.None);

        var refused = (await delete.Should().ThrowAsync<DomainRuleViolationException>()).Which;
        refused.Code.Should().Be("account.sole_owner");
        refused.Kind.Should().Be(ViolationKind.Conflict);
        refused.Extensions!["organizationIds"].Should().BeEquivalentTo(new[] { studio.OrganizationId });
        (await db.AsMasterAsync("SELECT count(*) FROM identity.user_accounts WHERE id = $1", owner.Id)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT status FROM organizations.memberships WHERE id = $1", studio.MembershipId)).Should().Be("active");
    }

    [Fact]
    public async Task AWrongEmail_Is400_AndNothingChanges()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (member, signIn) = await AccountAsync(db, "member");

        var delete = () => new AccountDeletionService(db).DeleteMineAsync(signIn, "someone-else@example.com", CancellationToken.None);

        (await delete.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("account.confirmation_mismatch");
        (await db.AsMasterAsync("SELECT count(*) FROM identity.user_accounts WHERE id = $1", member.Id)).Should().Be(1L);
    }

    [Fact]
    public async Task Deleting_RemovesTheLogin_AndKeepsThePersonWithItsHistory()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (ownerAccount, _) = await AccountAsync(db, "owner");
        var owner = await StudioAsync(db, ownerAccount, "main");
        var (member, signIn) = await AccountAsync(db, "member");
        var (membershipId, personId) = await JoinAsync(db, owner, member.Id, "client");
        await HistoryAsync(db, owner, personId);
        var other = await StudioAsync(db, (await AccountAsync(db, "other-owner")).Account, "other");
        var (otherMembership, _) = await JoinAsync(db, other, member.Id, "client");

        await new AccountDeletionService(db).DeleteMineAsync(signIn, "member@example.com", CancellationToken.None);

        // The login is gone: GET /me finds no account, and the sign-in link and join attempts went with it.
        (await new AccountService(db, new NoCognito()).FindAsync(Issuer, signIn.Subject, CancellationToken.None)).Should().BeNull();
        (await db.AsMasterAsync("SELECT count(*) FROM identity.user_accounts WHERE id = $1", member.Id)).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM identity.external_identities WHERE user_account_id = $1", member.Id)).Should().Be(0L);
        (await db.AsMasterAsync("SELECT count(*) FROM identity.join_attempts WHERE user_account_id = $1", member.Id)).Should().Be(0L);

        // Both memberships ended and point at no account; the person stays on the studio's roster, history intact.
        (await db.AsMasterAsync("SELECT string_agg(status || ':' || coalesce(user_account_id::text, '-'), ',') FROM organizations.memberships WHERE id = ANY($1)", new[] { membershipId, otherMembership }))
            .Should().Be("removed:-,removed:-");
        (await db.AsMasterAsync("SELECT status || ':' || coalesce(user_account_id::text, '-') || ':' || display_name FROM people.people WHERE id = $1", personId))
            .Should().Be("active:-:דנה לדוגמה");
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.bookings WHERE person_id = $1", personId)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT count(*) FROM scheduling.passes WHERE person_id = $1", personId)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT count(*) FROM notifications.push_subscriptions WHERE person_id = $1", personId)).Should().Be(0L);

        // One audit row per studio and one account-level row, none carrying the email.
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'account.deleted' AND target_id = $1", member.Id)).Should().Be(3L);
        (await db.AsMasterAsync("SELECT count(*) FROM audit.audit_events WHERE action = 'account.deleted' AND data::text ILIKE '%example.com%'")).Should().Be(0L);
    }

    [Fact]
    public async Task AfterDeletion_TheStudiosListsStillRead_TheRemovedMemberAndTheirInvitations()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (ownerAccount, _) = await AccountAsync(db, "owner");
        var owner = await StudioAsync(db, ownerAccount, "main");
        var (admin, adminSignIn) = await AccountAsync(db, "admin");
        var (adminMembership, _) = await JoinAsync(db, owner, admin.Id, "admin");
        var asAdmin = owner with { UserAccountId = admin.Id, MembershipId = adminMembership, Role = MembershipRole.Admin, Permissions = SystemRoles.Admin.Permissions };
        var invitations = new InvitationService(db, new AccountProfiles(db), new AttemptLimiter(db));
        await invitations.CreateAsync(asAdmin, "invitee@example.com", MembershipRole.Client, CancellationToken.None);

        await new AccountDeletionService(db).DeleteMineAsync(adminSignIn, "admin@example.com", CancellationToken.None);

        var removed = await new MemberService(db, new AccountProfiles(db)).ListAsync(owner, new MemberQuery(null, MembershipStatus.Removed, null, 50), CancellationToken.None);
        removed.Items.Should().ContainSingle(m => m.Id == adminMembership).Which.Email.Should().BeEmpty();
        (await invitations.ListAsync(owner, new InvitationQuery(null, null, 50), CancellationToken.None)).Items.Should().ContainSingle();
    }

    [Fact]
    public async Task ATransferToTheDeletedAdmin_IsCancelled()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (ownerAccount, _) = await AccountAsync(db, "owner");
        var owner = await StudioAsync(db, ownerAccount, "main");
        var (admin, adminSignIn) = await AccountAsync(db, "admin");
        var (adminMembership, _) = await JoinAsync(db, owner, admin.Id, "admin");
        await db.AsMasterAsync(
            "INSERT INTO organizations.ownership_transfers (organization_id, id, from_membership_id, to_membership_id, status, expires_at, created_at, updated_at) VALUES ($1, $2, $3, $4, 'pending', now() + interval '1 day', now(), now())",
            owner.OrganizationId, Guid.CreateVersion7(), owner.MembershipId, adminMembership);

        await new AccountDeletionService(db).DeleteMineAsync(adminSignIn, "admin@example.com", CancellationToken.None);

        (await db.AsMasterAsync("SELECT status FROM organizations.ownership_transfers WHERE to_membership_id = $1", adminMembership)).Should().Be("cancelled");
    }

    [Fact]
    public async Task AnOwnerWhoHandedTheStudioOn_CanDelete_AndTheStudioKeepsNoCreator()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var (founder, founderSignIn) = await AccountAsync(db, "founder");
        var studio = await StudioAsync(db, founder, "main");
        var (successor, _) = await AccountAsync(db, "successor");
        await db.AsMasterAsync("UPDATE organizations.memberships SET role = 'admin' WHERE id = $1", studio.MembershipId);
        await JoinAsync(db, studio, successor.Id, "owner");

        await new AccountDeletionService(db).DeleteMineAsync(founderSignIn, "founder@example.com", CancellationToken.None);

        (await db.AsMasterAsync("SELECT created_by_user_id IS NULL FROM organizations.organizations WHERE id = $1", studio.OrganizationId)).Should().Be(true);
    }

    private sealed record Account(Guid Id);

    private static async Task<(Account Account, SignIn SignIn)> AccountAsync(MigratedDatabase db, string name)
    {
        var id = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO identity.user_accounts (id, status, email, email_verified, identity_synced_at, created_at, updated_at) VALUES ($1, 'active', $2, true, now(), now(), now())",
            id, $"{name}@example.com");
        await db.AsMasterAsync(
            "INSERT INTO identity.external_identities (id, user_account_id, issuer, subject, created_at) VALUES ($1, $2, $3, $4, now())",
            Guid.CreateVersion7(), id, Issuer, $"sub-{name}");
        await db.AsMasterAsync("INSERT INTO identity.join_attempts (user_account_id, attempted_at) VALUES ($1, now())", id);
        return (new Account(id), new SignIn(Issuer, $"sub-{name}", $"user-{name}", DateTimeOffset.UtcNow, "test"));
    }

    private static async Task<TenantContext> StudioAsync(MigratedDatabase db, Account owner, string slug)
    {
        var organization = await new OrganizationService(db).CreateAsync(new AccountSnapshot(owner.Id, AccountStatus.Active, true), new NewOrganization("Main", $"studio-{slug}", null, null), "c", CancellationToken.None);
        var membership = (await new MembershipDirectory(db).FindAsync(owner.Id, organization.Id, CancellationToken.None))!;
        return new TenantContext(organization.Id, owner.Id, membership.MembershipId, MembershipRole.Owner, OrganizationStatus.Active, "test");
    }

    /// <summary>A membership for the account and its person record in the studio, as joining makes them.</summary>
    private static async Task<(Guid MembershipId, Guid PersonId)> JoinAsync(MigratedDatabase db, TenantContext studio, Guid account, string role)
    {
        var membership = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, $4, 'active', now(), now())",
            studio.OrganizationId, membership, account, role);
        var person = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO people.people (organization_id, id, display_name, status, user_account_id, membership_id, source, created_at, updated_at) VALUES ($1, $2, 'דנה לדוגמה', 'active', $3, $4, 'join_link', now(), now())",
            studio.OrganizationId, person, account, membership);
        return (membership, person);
    }

    /// <summary>A booking, a pass and a push subscription for the person.</summary>
    private static async Task HistoryAsync(MigratedDatabase db, TenantContext owner, Guid person)
    {
        var classType = await new Tempo.Platform.Modules.Scheduling.Application.TimetableService(db, TimeProvider.System)
            .CreateClassTypeAsync(owner, new Tempo.Platform.Modules.Scheduling.Application.NewClassType("פילאטיס", "pilates", "rose", 50, null), CancellationToken.None);
        var session = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, capacity, status, created_at, updated_at) VALUES ($1, $2, current_date, $3, now(), now() + interval '50 minutes', 8, 'scheduled', now(), now())",
            owner.OrganizationId, session, classType.Id);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, booked_by, created_at, updated_at) VALUES ($1, $2, $3, $4, 'attended', $5, now(), now())",
            owner.OrganizationId, Guid.CreateVersion7(), session, person, owner.MembershipId);
        var product = Guid.CreateVersion7();
        await db.AsMasterAsync(
            "INSERT INTO scheduling.pass_products (organization_id, id, kind, name, valid_days, status, created_at, updated_at) VALUES ($1, $2, 'membership', 'מנוי', 30, 'active', now(), now())",
            owner.OrganizationId, product);
        await db.AsMasterAsync(
            "INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, status, granted_by, created_at, updated_at) VALUES ($1, $2, $3, $4, current_date, current_date + 30, 'active', $5, now(), now())",
            owner.OrganizationId, Guid.CreateVersion7(), person, product, owner.MembershipId);
        await db.AsMasterAsync(
            "INSERT INTO notifications.push_subscriptions (organization_id, id, person_id, endpoint, p256dh, auth, device_label, created_at) VALUES ($1, $2, $3, 'https://push.example.com/e2e', 'key', 'auth', 'טלפון', now())",
            owner.OrganizationId, Guid.CreateVersion7(), person);
    }

    private sealed class NoCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Not used.");
    }
}

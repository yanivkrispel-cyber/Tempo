using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Identity.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// Just-in-time provisioning and the account routes (docs/26 sections 2.3,
/// 2.4 and 8.1) against PostgreSQL 18 as `tempo_app`, with Cognito stood in.
/// </summary>
public sealed class AccountServiceTests(PostgresFixture postgres) : IClassFixture<PostgresFixture>
{
    private const string Issuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";

    private readonly FakeCognito cognito = new();

    [Fact]
    public async Task FirstSession_CreatesTheAccountItsIdentityAndAnAuditEvent()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new AccountService(db, cognito);

        var account = await service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);

        account.Email.Should().Be("dana@example.com");
        account.EmailVerified.Should().BeTrue();
        account.Locale.Should().Be("he-IL");
        (await db.AsMasterAsync("SELECT count(*) FROM identity.external_identities WHERE issuer = $1 AND subject = 'sub-1'", Issuer)).Should().Be(1L);
        (await db.AsMasterAsync("SELECT action FROM audit.audit_events WHERE target_id = $1", account.Id)).Should().Be("account.created");
        cognito.Calls.Should().Be(1);
    }

    [Fact]
    public async Task SecondSession_ReturnsTheSameAccountWithoutAskingCognito()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new AccountService(db, cognito);
        var first = await service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);

        var second = await service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);

        second.Should().Be(first);
        cognito.Calls.Should().Be(1);
    }

    [Fact]
    public async Task ParallelFirstSessions_CreateOneAccount()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new AccountService(db, cognito);

        var accounts = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => service.StartSessionAsync(SignInAs("sub-race"), CancellationToken.None)));

        accounts.Select(a => a.Id).Distinct().Should().ContainSingle();
        (await db.AsMasterAsync("SELECT count(*) FROM identity.user_accounts")).Should().Be(1L);
    }

    [Fact]
    public async Task ANewerSignIn_RefreshesEmailFromCognito()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new AccountService(db, cognito);
        await service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);
        cognito.User = new CognitoUser("dana.new@example.com", false);

        var stale = await service.StartSessionAsync(SignInAs("sub-1", authTime: DateTimeOffset.UtcNow.AddHours(-1)), CancellationToken.None);
        var fresh = await service.StartSessionAsync(SignInAs("sub-1", authTime: DateTimeOffset.UtcNow.AddMinutes(1)), CancellationToken.None);

        stale.Email.Should().Be("dana@example.com", "a sign-in older than the last sync changes nothing");
        fresh.Email.Should().Be("dana.new@example.com");
        fresh.EmailVerified.Should().BeFalse();
        (await service.FindAsync(Issuer, "sub-1", CancellationToken.None))!.Email.Should().Be("dana.new@example.com");
    }

    [Fact]
    public async Task ANewerSignIn_RecordsWhetherMfaIsSetUp()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new AccountService(db, cognito);
        await service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);
        var directory = new Tempo.Platform.Modules.Identity.Infrastructure.AccountDirectory(db);
        (await directory.FindByExternalIdentityAsync(Issuer, "sub-1", CancellationToken.None))!.MfaEnabled.Should().BeFalse();

        cognito.User = new CognitoUser("dana@example.com", true, MfaEnabled: true);
        await service.StartSessionAsync(SignInAs("sub-1", authTime: DateTimeOffset.UtcNow.AddMinutes(1)), CancellationToken.None);

        (await directory.FindByExternalIdentityAsync(Issuer, "sub-1", CancellationToken.None))!.MfaEnabled.Should().BeTrue();
    }

    [Fact]
    public async Task Session_ForADisabledAccount_IsRefused()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new AccountService(db, cognito);
        var account = await service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);
        await db.AsMasterAsync("UPDATE identity.user_accounts SET status = 'disabled' WHERE id = $1", account.Id);

        var session = () => service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);

        (await session.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be("account.disabled");
        (await service.FindAsync(Issuer, "sub-1", CancellationToken.None))!.Status.Should().Be(AccountStatus.Disabled);
    }

    [Fact]
    public async Task Update_ChangesOnlyTheGivenFields()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new AccountService(db, cognito);
        var account = await service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);

        await service.UpdateAsync(account.Id, "  Dana  ", null, CancellationToken.None);
        var updated = await service.UpdateAsync(account.Id, null, "en-US", CancellationToken.None);

        updated.DisplayName.Should().Be("Dana");
        updated.Locale.Should().Be("en-US");
        (await db.AsMasterAsync("SELECT version FROM identity.user_accounts WHERE id = $1", account.Id)).Should().Be(2L);
    }

    [Theory]
    [InlineData(null, null, "request.empty")]
    [InlineData("   ", null, "display_name.length")]
    [InlineData(null, "fr-FR", "locale.unsupported")]
    public async Task Update_RejectsInvalidInput(string? displayName, string? locale, string code)
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var service = new AccountService(db, cognito);
        var account = await service.StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);

        var update = () => service.UpdateAsync(account.Id, displayName, locale, CancellationToken.None);

        (await update.Should().ThrowAsync<DomainRuleViolationException>()).Which.Code.Should().Be(code);
    }

    [Fact]
    public async Task Memberships_ListsTheAccountsLiveStudiosOnly()
    {
        await using var db = await MigratedDatabase.CreateAsync(postgres);
        var account = await new AccountService(db, cognito).StartSessionAsync(SignInAs("sub-1"), CancellationToken.None);
        var live = Guid.CreateVersion7();
        var left = Guid.CreateVersion7();
        foreach (var (studio, slug, status) in new[] { (live, "studio-live", "active"), (left, "studio-left", "removed") })
        {
            await db.AsMasterAsync(
                "INSERT INTO organizations.organizations (id, slug, display_name, status, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $2, 'active', $3, now(), now())",
                studio,
                slug,
                account.Id);
            await db.AsMasterAsync(
                "INSERT INTO organizations.memberships (organization_id, id, user_account_id, role, status, created_at, updated_at) VALUES ($1, $2, $3, 'client', $4, now(), now())",
                studio,
                Guid.CreateVersion7(),
                account.Id,
                status);
        }

        var memberships = await new MembershipDirectory(db).ListForAccountAsync(account.Id, CancellationToken.None);

        memberships.Should().ContainSingle().Which.Should().Match<AccountMembership>(m =>
            m.OrganizationId == live && m.Slug == "studio-live" && m.Role == MembershipRole.Client && m.Status == MembershipStatus.Active);
    }

    private static SignIn SignInAs(string subject, DateTimeOffset? authTime = null) =>
        new(Issuer, subject, $"user-{subject}", authTime, "test");

    private sealed class FakeCognito : ICognitoUserReader
    {
        private int calls;

        public CognitoUser User { get; set; } = new("dana@example.com", true);

        public int Calls => calls;

        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref calls);
            return Task.FromResult(User);
        }
    }
}

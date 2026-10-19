using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Platform.Modules.Marketing;

public sealed record IntroPassView(Guid PassId, string ProductName, bool ToPayAtStudio);

public sealed record PublicJoinResult(AccountMembership Membership, bool Created, IntroPassView? IntroPass);

/// <summary>
/// Open join from a studio's public page (docs/37 section 4.3, M-8, M-9, MK3): a signed-in person with a verified
/// email becomes an active client of a studio whose public page and open join are on, without a code. The first touch
/// is kept on the membership, and the studio's intro product is granted once per person, to pay at the studio.
/// Joining again returns the same membership and grants nothing.
/// </summary>
public interface IPublicJoinService
{
    Task<PublicJoinResult> JoinAsync(AccountSnapshot caller, PublicStudio studio, string? sourceCode, string correlationId, CancellationToken cancellationToken);
}

public sealed class PublicJoinService(IDataSourceProvider dataSources, IAttemptLimiter limiter, TimeProvider clock) : IPublicJoinService
{
    public async Task<PublicJoinResult> JoinAsync(AccountSnapshot caller, PublicStudio studio, string? sourceCode, string correlationId, CancellationToken cancellationToken)
    {
        await limiter.CheckAsync(caller.UserAccountId, cancellationToken);
        if (!caller.EmailVerified)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "account.email_not_verified", "Verify your email first.");
        }

        await using var unitOfWork = await UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, caller.UserAccountId, studio.Id, cancellationToken);
        Guid? introProduct;
        await using (var page = unitOfWork.Command(
            "SELECT enabled AND open_join, intro_product_id FROM organizations.public_pages WHERE organization_id = $1",
            studio.Id))
        await using (var reader = await page.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken) || !reader.GetBoolean(0))
            {
                throw new DomainRuleViolationException(ViolationKind.Forbidden, "join.closed", "This studio takes new members through its join link only.");
            }

            introProduct = reader.IsDBNull(1) ? null : reader.GetGuid(1);
        }

        var (membership, created) = await MembershipQueries.JoinAsync(unitOfWork, studio.Id, caller.UserAccountId, MembershipRole.Client, cancellationToken);
        IntroPassView? intro = null;
        if (created)
        {
            var link = await SourceLinks.FindAsync(unitOfWork, studio.Id, sourceCode, cancellationToken);
            if (link is { } first)
            {
                await using var mark = unitOfWork.Command(
                    "UPDATE organizations.memberships SET source_link_id = $3 WHERE organization_id = $1 AND id = $2 AND source_link_id IS NULL",
                    studio.Id, membership.MembershipId, first);
                await mark.ExecuteNonQueryAsync(cancellationToken);
            }

            await MembershipQueries.AuditAsync(unitOfWork, studio.Id, caller.UserAccountId, "membership.joined_via_public_page", "membership", membership.MembershipId, correlationId,
                new { role = "client", sourced = link is not null }, cancellationToken);
            if (introProduct is { } product)
            {
                intro = await GrantIntroAsync(unitOfWork, studio.Id, membership.MembershipId, caller.UserAccountId, product, correlationId, cancellationToken);
            }
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return new PublicJoinResult(membership, created, intro);
    }

    /// <summary>M-8: the intro product once per person and studio, marked "to pay at the studio"; nothing when it is archived.</summary>
    private async Task<IntroPassView?> GrantIntroAsync(UnitOfWork unitOfWork, Guid organizationId, Guid membershipId, Guid userAccountId, Guid productId, string correlationId, CancellationToken cancellationToken)
    {
        Guid person;
        await using (var find = unitOfWork.Command("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", organizationId, membershipId))
        {
            person = (Guid)(await find.ExecuteScalarAsync(cancellationToken))!;
        }

        string name;
        int validDays;
        int? entries;
        await using (var read = unitOfWork.Command(
            "SELECT name, valid_days, entries FROM scheduling.pass_products WHERE organization_id = $1 AND id = $2 AND status = 'active'",
            organizationId, productId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }

            name = reader.GetString(0);
            validDays = reader.GetInt32(1);
            entries = reader.IsDBNull(2) ? null : reader.GetInt32(2);
        }

        await using (var had = unitOfWork.Command(
            "SELECT 1 FROM scheduling.passes WHERE organization_id = $1 AND person_id = $2 AND product_id = $3",
            organizationId, person, productId))
        {
            if (await had.ExecuteScalarAsync(cancellationToken) is not null)
            {
                return null;
            }
        }

        var zone = await TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
        var passId = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, entries, status, granted_by, to_pay_at_studio, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, true, now(), now())
            """,
            organizationId, passId, person, productId, today, today.AddDays(validDays - 1), entries, membershipId))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(organizationId, "user", userAccountId, "pass.granted", "pass", passId, correlationId, new { personId = person, productId, source = "public_page", toPayAtStudio = true }),
            cancellationToken);
        return new IntroPassView(passId, name, true);
    }
}

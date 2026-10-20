using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Organizations.Infrastructure;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Platform.Modules.Marketing;

public sealed record IntroPassView(Guid PassId, string ProductName, bool ToPayAtStudio);

/// <summary>The place taken by the offer join (SK3): booked, or waiting when the class is full and has a waitlist.</summary>
public sealed record JoinBookingView(Guid BookingId, Guid SessionId, string Status);

/// <summary>
/// The join's result. <paramref name="Next"/> is `health_declaration` when the class could not be booked only because the
/// studio asks for a signed health declaration first: the membership and the pass are kept, and the app books after
/// the declaration.
/// </summary>
public sealed record PublicJoinResult(AccountMembership Membership, bool Created, IntroPassView? IntroPass, JoinBookingView? Booking = null, string? Next = null);

/// <summary>What the visitor asked for along with joining (SK3): a listed product to take and a class to book.</summary>
public sealed record PublicJoinRequestView(string? SourceCode, Guid? ProductId = null, Guid? SessionId = null);

/// <summary>
/// Open join from a studio's public page (docs/37 section 4.3, M-8, M-9, MK3): a signed-in person with a verified
/// email becomes an active client of a studio whose public page and open join are on, without a code. The first touch
/// is kept on the membership, and the studio's intro product is granted once per person, to pay at the studio.
/// Joining again returns the same membership and grants nothing.
///
/// The offer join (board #404 SL-4, SK3) does more in the same transaction: it grants a listed product, to pay at the
/// studio (once per person for a newcomers-only offer), and books a class. On any refusal nothing is joined, granted or
/// booked, except the one case <see cref="PublicJoinResult.Next"/> describes.
/// </summary>
public interface IPublicJoinService
{
    Task<PublicJoinResult> JoinAsync(AccountSnapshot caller, PublicStudio studio, PublicJoinRequestView request, string correlationId, CancellationToken cancellationToken);
}

public sealed class PublicJoinService(IDataSourceProvider dataSources, IAttemptLimiter limiter, TimeProvider clock, BookingService bookings) : IPublicJoinService
{
    public const string HealthDeclarationNext = "health_declaration";

    public async Task<PublicJoinResult> JoinAsync(AccountSnapshot caller, PublicStudio studio, PublicJoinRequestView request, string correlationId, CancellationToken cancellationToken)
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
        IntroPassView? granted = null;
        if (created)
        {
            var link = await SourceLinks.FindAsync(unitOfWork, studio.Id, request.SourceCode, cancellationToken);
            if (link is { } first)
            {
                await using var mark = unitOfWork.Command(
                    "UPDATE organizations.memberships SET source_link_id = $3 WHERE organization_id = $1 AND id = $2 AND source_link_id IS NULL",
                    studio.Id, membership.MembershipId, first);
                await mark.ExecuteNonQueryAsync(cancellationToken);
            }

            await MembershipQueries.AuditAsync(unitOfWork, studio.Id, caller.UserAccountId, "membership.joined_via_public_page", "membership", membership.MembershipId, correlationId,
                new { role = "client", sourced = link is not null }, cancellationToken);
        }

        var person = await PersonAsync(unitOfWork, studio.Id, membership.MembershipId, cancellationToken);
        if (request.ProductId is { } offered)
        {
            granted = await GrantOfferAsync(unitOfWork, studio.Id, person, membership.MembershipId, caller.UserAccountId, offered, correlationId, cancellationToken);
        }
        else if (created && introProduct is { } product)
        {
            granted = await GrantIntroAsync(unitOfWork, studio.Id, person, membership.MembershipId, caller.UserAccountId, product, correlationId, cancellationToken);
        }

        JoinBookingView? booking = null;
        string? next = null;
        if (request.SessionId is { } sessionId)
        {
            var tenant = new TenantContext(studio.Id, caller.UserAccountId, membership.MembershipId, MembershipRole.Client, OrganizationStatus.Active, correlationId);
            try
            {
                var bookingId = await bookings.BookInAsync(unitOfWork, tenant, sessionId, null, null, request.SourceCode, cancellationToken);
                booking = await BookingAsync(unitOfWork, studio.Id, bookingId, cancellationToken);
            }
            catch (DomainRuleViolationException e) when (e.Code == "health.declaration_required")
            {
                // Nothing of the booking was written: the gate comes first. The member signs, then books.
                next = HealthDeclarationNext;
            }
            catch (DomainRuleViolationException e) when (e.Code is "session.cancelled" or "booking.closed" or "booking.not_open")
            {
                throw new DomainRuleViolationException(ViolationKind.Conflict, "session.not_bookable", "This class can't be booked now.");
            }
        }

        await unitOfWork.CommitAsync(cancellationToken);
        return new PublicJoinResult(membership, created, granted, booking, next);
    }

    private static async Task<Guid> PersonAsync(UnitOfWork unitOfWork, Guid organizationId, Guid membershipId, CancellationToken cancellationToken)
    {
        await using var find = unitOfWork.Command("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", organizationId, membershipId);
        return (Guid)(await find.ExecuteScalarAsync(cancellationToken))!;
    }

    private static async Task<JoinBookingView> BookingAsync(UnitOfWork unitOfWork, Guid organizationId, Guid bookingId, CancellationToken cancellationToken)
    {
        await using var read = unitOfWork.Command("SELECT session_id, status FROM scheduling.bookings WHERE organization_id = $1 AND id = $2", organizationId, bookingId);
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return new JoinBookingView(bookingId, reader.GetGuid(0), reader.GetString(1));
    }

    /// <summary>
    /// SL-4: a product the studio lists, granted to pay at the studio. 404 `product.not_found` when it isn't listed here,
    /// 409 `offer.ended` once archived or past its last day, 409 `offer.not_newcomer` for a newcomers-only offer the
    /// person holds or held.
    /// </summary>
    private async Task<IntroPassView> GrantOfferAsync(UnitOfWork unitOfWork, Guid organizationId, Guid person, Guid membershipId, Guid userAccountId, Guid productId, string correlationId, CancellationToken cancellationToken)
    {
        string name;
        int validDays;
        int? entries;
        bool newcomersOnly;
        bool ended;
        var zone = await TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
        await using (var read = unitOfWork.Command(
            """
            SELECT name, valid_days, entries, newcomers_only, status <> 'active' OR coalesce(public_until < $3, false)
            FROM scheduling.pass_products
            WHERE organization_id = $1 AND id = $2 AND public_listed
            """,
            organizationId, productId, today))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "product.not_found", "There is no such offer here.");
            }

            name = reader.GetString(0);
            validDays = reader.GetInt32(1);
            entries = reader.IsDBNull(2) ? null : reader.GetInt32(2);
            newcomersOnly = reader.GetBoolean(3);
            ended = reader.GetBoolean(4);
        }

        if (ended)
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "offer.ended", "This offer has ended.");
        }

        if (newcomersOnly && await HeldAsync(unitOfWork, organizationId, person, productId, cancellationToken))
        {
            throw new DomainRuleViolationException(ViolationKind.Conflict, "offer.not_newcomer", "This offer is for newcomers.");
        }

        return await GrantAsync(unitOfWork, organizationId, person, membershipId, userAccountId, productId, name, validDays, entries, "public_offer", correlationId, today, cancellationToken);
    }

    /// <summary>M-8: the intro product once per person and studio, marked "to pay at the studio"; nothing when it is archived.</summary>
    private async Task<IntroPassView?> GrantIntroAsync(UnitOfWork unitOfWork, Guid organizationId, Guid person, Guid membershipId, Guid userAccountId, Guid productId, string correlationId, CancellationToken cancellationToken)
    {
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

        if (await HeldAsync(unitOfWork, organizationId, person, productId, cancellationToken))
        {
            return null;
        }

        var zone = await TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
        return await GrantAsync(unitOfWork, organizationId, person, membershipId, userAccountId, productId, name, validDays, entries, "public_page", correlationId, today, cancellationToken);
    }

    /// <summary>
    /// Whether the person holds or ever held a pass of this product here. A lock per person first, so two joins of one
    /// person at once grant a newcomers-only offer once: the second waits and then sees the first's pass.
    /// </summary>
    private static async Task<bool> HeldAsync(UnitOfWork unitOfWork, Guid organizationId, Guid person, Guid productId, CancellationToken cancellationToken)
    {
        await using (var lockPerson = unitOfWork.Command("SELECT pg_advisory_xact_lock(hashtextextended('scheduling.person_offer:' || $1::text, 0))", person))
        {
            await lockPerson.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var had = unitOfWork.Command(
            "SELECT 1 FROM scheduling.passes WHERE organization_id = $1 AND person_id = $2 AND product_id = $3",
            organizationId, person, productId);
        return await had.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private static async Task<IntroPassView> GrantAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid person,
        Guid membershipId,
        Guid userAccountId,
        Guid productId,
        string name,
        int validDays,
        int? entries,
        string source,
        string correlationId,
        DateOnly today,
        CancellationToken cancellationToken)
    {
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
            new AuditEvent(organizationId, "user", userAccountId, "pass.granted", "pass", passId, correlationId, new { personId = person, productId, source, toPayAtStudio = true }),
            cancellationToken);
        return new IntroPassView(passId, name, true);
    }
}

using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Notifications.Application;

namespace Tempo.Platform.Modules.Marketing;

/// <summary>
/// What a booking marked attended starts in stage B of studio marketing (docs/37 sections 8.2 and 8.5), inside the
/// transaction that marks it: a milestone notice at 10, 25, 50, 100 and 200 attended classes in the studio (M-16),
/// and the bring-a-friend reward when a referred friend's first booking is attended (M-17). Both are written once:
/// the notice by its dedupe key, the reward by its one row per friend.
/// </summary>
public static class AttendanceEffects
{
    public static readonly IReadOnlyList<int> Milestones = [10, 25, 50, 100, 200];

    /// <summary>At most this many rewards per referrer in a calendar month (M-17).</summary>
    public const int RewardsPerMonth = 10;

    private static readonly IReadOnlyDictionary<string, Guid> NoData = new Dictionary<string, Guid>();

    /// <summary>Call after a booking moved to `attended` (not when it already was).</summary>
    public static async Task OnAttendedAsync(UnitOfWork unitOfWork, Guid organizationId, Guid bookingId, Guid actorUserAccountId, string correlationId, CancellationToken cancellationToken)
    {
        Guid person;
        Guid? membership;
        long attended;
        await using (var read = unitOfWork.Command(
            """
            SELECT p.id, p.membership_id,
                   (SELECT count(*) FROM scheduling.bookings a WHERE a.organization_id = p.organization_id AND a.person_id = p.id AND a.status = 'attended')
            FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            WHERE b.organization_id = $1 AND b.id = $2
            """,
            organizationId, bookingId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return;
            }

            person = reader.GetGuid(0);
            membership = reader.IsDBNull(1) ? null : reader.GetGuid(1);
            attended = reader.GetInt64(2);
        }

        if (Milestones.Contains((int)attended))
        {
            await NotificationRequests.WriteAsync(
                unitOfWork,
                new NotificationRequest(organizationId, person, "member.milestone", "person", person, NoData, attended.ToString(System.Globalization.CultureInfo.InvariantCulture)),
                cancellationToken);
        }

        if (attended == 1 && membership is { } friend)
        {
            await RewardReferrerAsync(unitOfWork, organizationId, friend, actorUserAccountId, correlationId, cancellationToken);
        }
    }

    private static async Task RewardReferrerAsync(UnitOfWork unitOfWork, Guid organizationId, Guid friendMembership, Guid actorUserAccountId, string correlationId, CancellationToken cancellationToken)
    {
        // The friend joined from the public page with a referral link (first touch), the studio picked a reward, and the
        // referrer is still an active member with a person record.
        Guid referrer;
        Guid referrerPerson;
        Guid product;
        int validDays;
        int? entries;
        await using (var read = unitOfWork.Command(
            """
            SELECT l.created_by, rp.id, pr.id, pr.valid_days, pr.entries
            FROM organizations.memberships f
            JOIN marketing.links l ON l.organization_id = f.organization_id AND l.id = f.source_link_id AND l.channel = 'referral'
            JOIN organizations.memberships r ON r.organization_id = l.organization_id AND r.id = l.created_by AND r.status = 'active'
            JOIN people.people rp ON rp.organization_id = r.organization_id AND rp.membership_id = r.id AND rp.status = 'active'
            JOIN organizations.public_pages pp ON pp.organization_id = f.organization_id
            JOIN scheduling.pass_products pr ON pr.organization_id = pp.organization_id AND pr.id = pp.referral_reward_product_id AND pr.status = 'active'
            WHERE f.organization_id = $1 AND f.id = $2 AND l.created_by <> f.id
            """,
            organizationId, friendMembership))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return;
            }

            referrer = reader.GetGuid(0);
            referrerPerson = reader.GetGuid(1);
            product = reader.GetGuid(2);
            validDays = reader.GetInt32(3);
            entries = reader.IsDBNull(4) ? null : reader.GetInt32(4);
        }

        await using (var cap = unitOfWork.Command(
            """
            SELECT
                EXISTS (SELECT 1 FROM marketing.referral_rewards WHERE organization_id = $1 AND friend_membership_id = $2),
                (SELECT count(*) FROM marketing.referral_rewards WHERE organization_id = $1 AND referrer_membership_id = $3
                   AND rewarded_at >= date_trunc('month', now()))
            """,
            organizationId, friendMembership, referrer))
        await using (var reader = await cap.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            if (reader.GetBoolean(0) || reader.GetInt64(1) >= RewardsPerMonth)
            {
                return;
            }
        }

        var zone = await Scheduling.Application.TimetableService.StudioZoneAsync(unitOfWork, organizationId, cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).DateTime);
        var passId = Guid.CreateVersion7();
        await using (var grant = unitOfWork.Command(
            """
            INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, entries, status, granted_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, now(), now())
            """,
            organizationId, passId, referrerPerson, product, today, today.AddDays(validDays - 1), entries, referrer))
        {
            await grant.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var reward = unitOfWork.Command(
            "INSERT INTO marketing.referral_rewards (organization_id, friend_membership_id, referrer_membership_id, pass_id, rewarded_at) VALUES ($1, $2, $3, $4, now())",
            organizationId, friendMembership, referrer, passId))
        {
            await reward.ExecuteNonQueryAsync(cancellationToken);
        }

        // Ids only (docs/37 section 8.5); the referrer's notice never names the friend.
        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(organizationId, "user", actorUserAccountId, "referral.rewarded", "pass", passId, correlationId,
                new { referrerMembershipId = referrer, friendMembershipId = friendMembership, productId = product }),
            cancellationToken);
        await NotificationRequests.WriteAsync(
            unitOfWork,
            new NotificationRequest(organizationId, referrerPerson, "member.referral_rewarded", "pass", passId, new Dictionary<string, Guid> { ["passId"] = passId }),
            cancellationToken);
    }
}

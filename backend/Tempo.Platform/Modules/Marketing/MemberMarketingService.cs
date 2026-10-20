using System.Globalization;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Marketing;

public sealed record MyMilestonesView(
    int Attended,
    IReadOnlyList<int> Reached,
    int? Next,
    double HoursOnTheMat,
    int LongestWeekStreak,
    string? UsualTime,
    string? TopInstructor);

/// <summary>
/// The member's own side of stage B (docs/37 sections 8.2 and 8.5): their own share links (one per channel, reused)
/// and their milestones, computed live under RLS from attended bookings (no table, no job). Nothing here shows
/// another member.
/// </summary>
public interface IMemberMarketingService
{
    /// <summary>
    /// The member's own link per channel (and class, for a card), made on first use. <paramref name="showName"/> switches
    /// whether the invite shows their first name (SL-8, default on); left out, it stays as it was.
    /// </summary>
    Task<MarketingLinkView> ShareLinkAsync(TenantContext tenant, string? channel, Guid? sessionId, CancellationToken cancellationToken, bool? showName = null);

    Task<MyMilestonesView> MilestonesAsync(TenantContext tenant, CancellationToken cancellationToken);
}

public sealed class MemberMarketingService(IDataSourceProvider dataSources) : IMemberMarketingService
{
    public async Task<MarketingLinkView> ShareLinkAsync(TenantContext tenant, string? channel, Guid? sessionId, CancellationToken cancellationToken, bool? showName = null)
    {
        if (channel is not ("member_card" or "referral"))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "channel.invalid", "A member shares a card or a referral.", "channel");
        }

        var session = channel == "member_card" ? sessionId : null;
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        if (session is { } id)
        {
            await using var exists = unitOfWork.Command("SELECT 1 FROM scheduling.sessions WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, id);
            if (await exists.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "session.not_found", "Class not found.");
            }
        }

        string slug;
        await using (var read = unitOfWork.Command("SELECT slug FROM organizations.organizations WHERE id = $1", tenant.OrganizationId))
        {
            slug = (string)(await read.ExecuteScalarAsync(cancellationToken))!;
        }

        await using (var find = unitOfWork.Command(
            """
            SELECT id, code, created_at, show_name FROM marketing.links
            WHERE organization_id = $1 AND created_by = $2 AND channel = $3 AND session_id IS NOT DISTINCT FROM $4
            ORDER BY created_at LIMIT 1
            """,
            tenant.OrganizationId, tenant.MembershipId, channel, session))
        {
            find.Parameters[3].NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid;
            await using var reader = await find.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                var existing = new MarketingLinkView(reader.GetGuid(0), reader.GetString(1), channel, null, session, slug, reader.GetFieldValue<DateTimeOffset>(2), Kind(session), session, reader.GetBoolean(3));
                await reader.DisposeAsync();
                if (showName is not { } wanted || wanted == existing.ShowName)
                {
                    return existing;
                }

                // Only the member's own link (created_by): the app role may update show_name on any link of the studio.
                await using var update = unitOfWork.Command(
                    "UPDATE marketing.links SET show_name = $4 WHERE organization_id = $1 AND id = $2 AND created_by = $3",
                    tenant.OrganizationId, existing.Id, tenant.MembershipId, wanted);
                await update.ExecuteNonQueryAsync(cancellationToken);
                await unitOfWork.CommitAsync(cancellationToken);
                return existing with { ShowName = wanted };
            }
        }

        const int Attempts = 5;
        for (var attempt = 0; attempt < Attempts; attempt++)
        {
            var linkId = Guid.CreateVersion7();
            var code = MarketingLinkService.NewCode();
            await using var savepoint = unitOfWork.Command("SAVEPOINT member_link");
            await savepoint.ExecuteNonQueryAsync(cancellationToken);
            try
            {
                await using var insert = unitOfWork.Command(
                    "INSERT INTO marketing.links (organization_id, id, code, channel, session_id, target_kind, target_id, show_name, created_by, created_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::uuid IS NULL THEN 'schedule' ELSE 'session' END, $5, $7, $6, now()) RETURNING created_at",
                    tenant.OrganizationId, linkId, code, channel, session, tenant.MembershipId, showName ?? true);
                insert.Parameters[4].NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid;
                DateTimeOffset createdAt;
                await using (var inserted = await insert.ExecuteReaderAsync(cancellationToken))
                {
                    await inserted.ReadAsync(cancellationToken);
                    createdAt = inserted.GetFieldValue<DateTimeOffset>(0);
                }

                await unitOfWork.CommitAsync(cancellationToken);
                return new MarketingLinkView(linkId, code, channel, null, session, slug, createdAt, Kind(session), session, showName ?? true);
            }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && attempt < Attempts - 1)
            {
                await using var rollback = unitOfWork.Command("ROLLBACK TO SAVEPOINT member_link");
                await rollback.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        throw new InvalidOperationException("No free link code after several tries.");
    }

    public async Task<MyMilestonesView> MilestonesAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        Guid person;
        await using (var me = unitOfWork.Command("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", tenant.OrganizationId, tenant.MembershipId))
        {
            person = await me.ExecuteScalarAsync(cancellationToken) as Guid?
                ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "You have no member record in this studio.");
        }

        var zone = await Scheduling.Application.TimetableService.StudioZoneAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var classes = new List<(DateTime Local, double Hours, string? Instructor)>();
        await using (var read = unitOfWork.Command(
            """
            SELECT s.starts_at, s.ends_at, CASE WHEN sp.public_profile THEN pe.display_name END
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            LEFT JOIN organizations.staff_profiles sp ON sp.organization_id = s.organization_id AND sp.membership_id = s.instructor_membership_id
            LEFT JOIN people.people pe ON pe.organization_id = s.organization_id AND pe.membership_id = s.instructor_membership_id
            WHERE b.organization_id = $1 AND b.person_id = $2 AND b.status = 'attended'
            ORDER BY s.starts_at
            """,
            tenant.OrganizationId, person))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var starts = reader.GetFieldValue<DateTimeOffset>(0);
                var ends = reader.GetFieldValue<DateTimeOffset>(1);
                classes.Add((TimeZoneInfo.ConvertTime(starts, zone).DateTime, (ends - starts).TotalHours, reader.IsDBNull(2) ? null : reader.GetString(2)));
            }
        }

        return Compute(classes);
    }

    /// <summary>The milestone card's numbers from the attended classes in local time (docs/37 section 8.2, M-16).</summary>
    public static MyMilestonesView Compute(IReadOnlyList<(DateTime Local, double Hours, string? Instructor)> classes)
    {
        var attended = classes.Count;
        var reached = AttendanceEffects.Milestones.Where(m => m <= attended).ToList();
        int? next = AttendanceEffects.Milestones.FirstOrDefault(m => m > attended) is var n and > 0 ? n : null;
        var usual = classes.GroupBy(c => c.Local.ToString("HH:mm", CultureInfo.InvariantCulture))
            .OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).Select(g => g.Key).FirstOrDefault();
        var instructor = classes.Where(c => c.Instructor is not null).GroupBy(c => c.Instructor!)
            .OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).Select(g => g.Key).FirstOrDefault();

        // Weeks run Sunday to Saturday, as in Israel; a run counts weeks in a row with at least one class.
        var weeks = classes.Select(c => DateOnly.FromDateTime(c.Local.Date.AddDays(-(int)c.Local.DayOfWeek)).DayNumber / 7).Distinct().Order().ToList();
        var longest = 0;
        var run = 0;
        for (var i = 0; i < weeks.Count; i++)
        {
            run = i > 0 && weeks[i] == weeks[i - 1] + 1 ? run + 1 : 1;
            longest = Math.Max(longest, run);
        }

        return new MyMilestonesView(attended, reached, next, Math.Round(classes.Sum(c => c.Hours), 1), longest, usual, instructor);
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);

    private static string Kind(Guid? session) => session is null ? "schedule" : "session";
}

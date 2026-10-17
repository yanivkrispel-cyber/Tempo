using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Notifications.Application;

public sealed record AnnouncementAllowanceView(int Recipients, int MaxRecipients, int SentToday, int DailyLimit);

public sealed record AnnouncementView(Guid Id, int Recipients, DateTimeOffset SentAt, int SentToday, int DailyLimit);

/// <summary>
/// A studio announcement to every active member (docs/30 section 13 step 7): one `studio.announcement` inbox item
/// each, through the members' preferences and quiet hours. At most <see cref="DailyLimit"/> a day in the studio's
/// time zone and <see cref="MaxRecipients"/> recipients, so one click cannot wake the database or the push services
/// at scale. The text lives in `notifications.announcements` once; the audit keeps the count, never the text.
/// </summary>
public interface IAnnouncementService
{
    Task<AnnouncementAllowanceView> GetAllowanceAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<AnnouncementView> SendAsync(TenantContext tenant, string? subject, string? body, CancellationToken cancellationToken);
}

public sealed class AnnouncementService(IDataSourceProvider dataSources, TimeProvider clock) : IAnnouncementService
{
    public const string Kind = "studio.announcement";
    public const int DailyLimit = 3;
    public const int MaxRecipients = 500;
    public const int SubjectMax = 80;
    public const int BodyMax = 1000;

    /// <summary>People with an active membership in the studio; staff-created records without an account have no inbox.</summary>
    private const string ActiveMembers = """
        FROM people.people pe
        JOIN organizations.memberships m ON m.organization_id = pe.organization_id AND m.id = pe.membership_id AND m.status = 'active'
        WHERE pe.organization_id = $1 AND pe.status = 'active'
        """;

    public async Task<AnnouncementAllowanceView> GetAllowanceAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var (dayStarts, _) = await TodayAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        await using var command = unitOfWork.Command($"SELECT count(*)::int {ActiveMembers}", tenant.OrganizationId);
        var recipients = (int)(await command.ExecuteScalarAsync(cancellationToken))!;
        return new(recipients, MaxRecipients, await SentSinceAsync(unitOfWork, tenant.OrganizationId, dayStarts, cancellationToken), DailyLimit);
    }

    public async Task<AnnouncementView> SendAsync(TenantContext tenant, string? subject, string? body, CancellationToken cancellationToken)
    {
        var title = subject?.Trim() ?? string.Empty;
        var text = body?.Trim() ?? string.Empty;
        // One line: no \n, no bare \r, and no other control character (#208).
        if (title.Length is 0 or > SubjectMax || title.Any(char.IsControl))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "announcement.invalid", $"Write one line of 1 to {SubjectMax} characters.", "subject");
        }

        if (text.Length is 0 or > BodyMax)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "announcement.invalid", $"Write 1 to {BodyMax} characters.", "body");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        // Two sends at once wait for each other, so both cannot pass the daily count below.
        await using (var lockCommand = unitOfWork.Command("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", $"notifications.announcements:{tenant.OrganizationId}"))
        {
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        var now = clock.GetUtcNow();
        var (dayStarts, nextDay) = await TodayAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        var sentToday = await SentSinceAsync(unitOfWork, tenant.OrganizationId, dayStarts, cancellationToken);
        if (sentToday >= DailyLimit)
        {
            throw new DomainRuleViolationException(ViolationKind.TooManyRequests, "announcement.daily_limit", $"At most {DailyLimit} announcements a day.")
            {
                RetryAfter = nextDay - now,
                Extensions = new Dictionary<string, object?> { ["dailyLimit"] = DailyLimit }
            };
        }

        var recipients = new List<Guid>();
        await using (var list = unitOfWork.Command($"SELECT pe.id {ActiveMembers} ORDER BY pe.id LIMIT {MaxRecipients + 1}", tenant.OrganizationId))
        await using (var reader = await list.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                recipients.Add(reader.GetGuid(0));
            }
        }

        if (recipients.Count > MaxRecipients)
        {
            await using var count = unitOfWork.Command($"SELECT count(*)::int {ActiveMembers}", tenant.OrganizationId);
            throw new DomainRuleViolationException(ViolationKind.Conflict, "announcement.too_many_recipients", $"An announcement reaches at most {MaxRecipients} members.")
            {
                Extensions = new Dictionary<string, object?> { ["recipients"] = (int)(await count.ExecuteScalarAsync(cancellationToken))!, ["maxRecipients"] = MaxRecipients }
            };
        }

        var id = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            "INSERT INTO notifications.announcements (organization_id, id, sent_by, subject, body, recipients, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            tenant.OrganizationId, id, tenant.MembershipId, title, text, recipients.Count, now))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var personId in recipients)
        {
            await NotificationRequests.WriteAsync(
                unitOfWork,
                new NotificationRequest(tenant.OrganizationId, personId, Kind, "announcement", id, new Dictionary<string, Guid> { ["announcementId"] = id }, "announcement"),
                cancellationToken);
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "announcement.sent", "announcement", id, tenant.CorrelationId, new { recipients = recipients.Count }),
            cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new(id, recipients.Count, now, sentToday + 1, DailyLimit);
    }

    /// <summary>When the studio's day began and when the next one begins, as instants.</summary>
    private async Task<(DateTimeOffset Starts, DateTimeOffset Next)> TodayAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT time_zone FROM organizations.organizations WHERE id = $1", organizationId);
        var zone = TimeZoneInfo.FindSystemTimeZoneById((string)(await command.ExecuteScalarAsync(cancellationToken))!);
        var today = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).Date;
        return (MidnightUtc(today, zone), MidnightUtc(today.AddDays(1), zone));
    }

    /// <summary>
    /// When a local day starts. Where the clocks jump forward at midnight (America/Santiago in September) midnight never
    /// happens and the day starts at the jump; where midnight comes twice, at the first one. Both use the offset just
    /// before midnight.
    /// </summary>
    public static DateTimeOffset MidnightUtc(DateTime localMidnight, TimeZoneInfo zone)
    {
        var local = DateTime.SpecifyKind(localMidnight.Date, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local) || zone.IsAmbiguousTime(local))
        {
            return new(local - zone.GetUtcOffset(local.AddTicks(-1)), TimeSpan.Zero);
        }

        return new(TimeZoneInfo.ConvertTimeToUtc(local, zone), TimeSpan.Zero);
    }

    private static async Task<int> SentSinceAsync(UnitOfWork unitOfWork, Guid organizationId, DateTimeOffset since, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT count(*)::int FROM notifications.announcements WHERE organization_id = $1 AND created_at >= $2", organizationId, since);
        return (int)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}

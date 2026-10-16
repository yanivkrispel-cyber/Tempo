using System.Globalization;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;
using Tempo.Platform.Modules.Notifications.Domain;

namespace Tempo.Platform.Modules.Notifications.Application;

public sealed record GroupChannels(string Group, bool Inbox, bool Push);

public sealed record ReminderSet(bool ClassTomorrow, bool ClassSoon, bool PassEnding, bool EntriesLow);

public sealed record NotificationPreferencesView(
    IReadOnlyList<GroupChannels> Groups,
    ReminderSet Reminders,
    QuietWindow? Quiet,
    QuietWindow StudioQuiet,
    ReminderSet StudioReminders,
    string TimeZone,
    long Version);

public sealed record NotificationPreferencesChange(IReadOnlyList<GroupChannels> Groups, ReminderSet Reminders, QuietWindow? Quiet);

public sealed record ReminderTimingView(
    bool ClassTomorrowEnabled,
    TimeOnly ClassTomorrowSendAt,
    bool ClassSoonEnabled,
    int ClassSoonHoursBefore,
    bool PassEndingEnabled,
    int PassEndingDaysBefore,
    bool EntriesLowEnabled,
    int EntriesLowLeft);

public sealed record NotificationSettingsView(QuietWindow Quiet, ReminderTimingView Reminders, string TimeZone, long Version);

/// <summary>
/// A member's notification preferences in one studio and the studio's own defaults (docs/30 sections 5 and 7,
/// D-4, D-5). No row means the default: inbox and push on for every group, every reminder on, the studio's quiet
/// hours; a studio without settings has 22:00 to 08:00 and the D-5 reminder timing.
/// </summary>
public interface INotificationPreferencesService
{
    Task<NotificationPreferencesView> GetMineAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<NotificationPreferencesView> UpdateMineAsync(TenantContext tenant, NotificationPreferencesChange change, long? expectedVersion, CancellationToken cancellationToken);

    Task<NotificationSettingsView> GetSettingsAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<NotificationSettingsView> UpdateSettingsAsync(TenantContext tenant, QuietWindow quiet, ReminderTimingView reminders, long? expectedVersion, CancellationToken cancellationToken);
}

public sealed class NotificationPreferencesService(IDataSourceProvider dataSources) : INotificationPreferencesService
{
    private static readonly string[] Reminders = ["class_tomorrow", "class_soon", "pass_ending", "entries_low"];

    public async Task<NotificationPreferencesView> GetMineAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonAsync(unitOfWork, tenant, cancellationToken);
        return await ReadMineAsync(unitOfWork, tenant.OrganizationId, person, cancellationToken);
    }

    public async Task<NotificationPreferencesView> UpdateMineAsync(TenantContext tenant, NotificationPreferencesChange change, long? expectedVersion, CancellationToken cancellationToken)
    {
        if (change.Groups.Count is < 1 or > 3)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "groups.invalid", "Send one to three groups.", "groups");
        }

        foreach (var group in change.Groups)
        {
            if (!NotificationGroups.All.Contains(group.Group))
            {
                throw new DomainRuleViolationException(ViolationKind.Validation, "group.invalid", "Use bookings, reminders or studio.", "groups");
            }

            if (!group.Inbox)
            {
                throw new DomainRuleViolationException(ViolationKind.Validation, "preferences.inbox_required", "The inbox stays on for every group.", "groups");
            }
        }

        if (change.Groups.Select(g => g.Group).Distinct().Count() != change.Groups.Count)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "groups.invalid", "Send each group once.", "groups");
        }

        if (change.Quiet is { } quiet && quiet.Starts == quiet.Ends)
        {
            throw QuietInvalid();
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonAsync(unitOfWork, tenant, cancellationToken);
        var current = await VersionAsync(unitOfWork, tenant.OrganizationId, person, cancellationToken);
        if (expectedVersion is { } expected && expected != current)
        {
            throw Conflict();
        }

        foreach (var group in change.Groups)
        {
            foreach (var (channel, enabled) in new[] { (NotificationRouter.Inbox, true), (NotificationRouter.Push, group.Push) })
            {
                await using var upsert = unitOfWork.Command(
                    """
                    INSERT INTO notifications.preferences (organization_id, person_id, "group", channel, enabled, updated_at)
                    VALUES ($1, $2, $3, $4, $5, now())
                    ON CONFLICT (organization_id, person_id, "group", channel) DO UPDATE SET enabled = $5, updated_at = now()
                    """,
                    tenant.OrganizationId, person, group.Group, channel, enabled);
                await upsert.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        var switches = new[] { change.Reminders.ClassTomorrow, change.Reminders.ClassSoon, change.Reminders.PassEnding, change.Reminders.EntriesLow };
        for (var i = 0; i < Reminders.Length; i++)
        {
            await using var upsert = unitOfWork.Command(
                """
                INSERT INTO notifications.reminder_switches (organization_id, person_id, reminder, enabled, updated_at)
                VALUES ($1, $2, $3, $4, now())
                ON CONFLICT (organization_id, person_id, reminder) DO UPDATE SET enabled = $4, updated_at = now()
                """,
                tenant.OrganizationId, person, Reminders[i], switches[i]);
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }

        if (change.Quiet is { } window)
        {
            await using var upsert = unitOfWork.Command(
                """
                INSERT INTO notifications.quiet_hours (organization_id, person_id, starts_local, ends_local, updated_at)
                VALUES ($1, $2, $3, $4, now())
                ON CONFLICT (organization_id, person_id) DO UPDATE SET starts_local = $3, ends_local = $4, updated_at = now()
                """,
                tenant.OrganizationId, person, window.Starts, window.Ends);
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }
        else
        {
            await using var delete = unitOfWork.Command("DELETE FROM notifications.quiet_hours WHERE organization_id = $1 AND person_id = $2", tenant.OrganizationId, person);
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var bump = unitOfWork.Command(
            """
            INSERT INTO notifications.preference_versions (organization_id, person_id, version, updated_at) VALUES ($1, $2, 1, now())
            ON CONFLICT (organization_id, person_id) DO UPDATE SET version = notifications.preference_versions.version + 1, updated_at = now()
            """,
            tenant.OrganizationId, person))
        {
            await bump.ExecuteNonQueryAsync(cancellationToken);
        }

        // Which switches, never times or anything else about the person (docs/30 section 10).
        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "preference.changed", "person", person, tenant.CorrelationId,
                new { groups = change.Groups.Select(g => new { g.Group, g.Push }), change.Reminders, quietHours = change.Quiet is not null }),
            cancellationToken);
        var updated = await ReadMineAsync(unitOfWork, tenant.OrganizationId, person, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<NotificationSettingsView> GetSettingsAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        return await ReadSettingsAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
    }

    public async Task<NotificationSettingsView> UpdateSettingsAsync(TenantContext tenant, QuietWindow quiet, ReminderTimingView reminders, long? expectedVersion, CancellationToken cancellationToken)
    {
        if (quiet.Starts == quiet.Ends)
        {
            throw QuietInvalid();
        }

        Range(reminders.ClassSoonHoursBefore, 1, 12, "reminders.classSoon.hoursBefore");
        Range(reminders.PassEndingDaysBefore, 1, 30, "reminders.passEnding.daysBefore");
        Range(reminders.EntriesLowLeft, 1, 5, "reminders.entriesLow.entriesLeft");

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var current = await ReadSettingsAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        if (expectedVersion is { } expected && expected != current.Version)
        {
            throw Conflict();
        }

        await using (var upsert = unitOfWork.Command(
            """
            INSERT INTO notifications.studio_settings (organization_id, quiet_starts_local, quiet_ends_local,
                class_tomorrow_enabled, class_tomorrow_send_at, class_soon_enabled, class_soon_hours_before,
                pass_ending_enabled, pass_ending_days_before, entries_low_enabled, entries_low_left, updated_at, version)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), 1)
            ON CONFLICT (organization_id) DO UPDATE SET
                quiet_starts_local = $2, quiet_ends_local = $3, class_tomorrow_enabled = $4, class_tomorrow_send_at = $5,
                class_soon_enabled = $6, class_soon_hours_before = $7, pass_ending_enabled = $8, pass_ending_days_before = $9,
                entries_low_enabled = $10, entries_low_left = $11, updated_at = now(), version = notifications.studio_settings.version + 1
            """,
            tenant.OrganizationId, quiet.Starts, quiet.Ends,
            reminders.ClassTomorrowEnabled, reminders.ClassTomorrowSendAt, reminders.ClassSoonEnabled, reminders.ClassSoonHoursBefore,
            reminders.PassEndingEnabled, reminders.PassEndingDaysBefore, reminders.EntriesLowEnabled, reminders.EntriesLowLeft))
        {
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }

        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "notification_settings.updated", "organization", tenant.OrganizationId, tenant.CorrelationId,
                new { quietStarts = quiet.Starts.ToString("HH:mm", CultureInfo.InvariantCulture), quietEnds = quiet.Ends.ToString("HH:mm", CultureInfo.InvariantCulture), reminders }),
            cancellationToken);
        var updated = await ReadSettingsAsync(unitOfWork, tenant.OrganizationId, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return updated;
    }

    private static async Task<NotificationPreferencesView> ReadMineAsync(UnitOfWork unitOfWork, Guid organizationId, Guid person, CancellationToken cancellationToken)
    {
        var push = new Dictionary<string, bool>();
        await using (var command = unitOfWork.Command(
            "SELECT \"group\", enabled FROM notifications.preferences WHERE organization_id = $1 AND person_id = $2 AND channel = 'push'",
            organizationId, person))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                push[reader.GetString(0)] = reader.GetBoolean(1);
            }
        }

        var switches = new Dictionary<string, bool>();
        await using (var command = unitOfWork.Command(
            "SELECT reminder, enabled FROM notifications.reminder_switches WHERE organization_id = $1 AND person_id = $2",
            organizationId, person))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                switches[reader.GetString(0)] = reader.GetBoolean(1);
            }
        }

        QuietWindow? quiet = null;
        await using (var command = unitOfWork.Command(
            "SELECT starts_local, ends_local FROM notifications.quiet_hours WHERE organization_id = $1 AND person_id = $2",
            organizationId, person))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                quiet = new QuietWindow(await reader.GetFieldValueAsync<TimeOnly>(0, cancellationToken), await reader.GetFieldValueAsync<TimeOnly>(1, cancellationToken));
            }
        }

        var studio = await ReadSettingsAsync(unitOfWork, organizationId, cancellationToken);
        var version = await VersionAsync(unitOfWork, organizationId, person, cancellationToken);
        bool On(string reminder) => switches.GetValueOrDefault(reminder, true);
        return new NotificationPreferencesView(
            [.. NotificationGroups.All.Select(g => new GroupChannels(g, true, push.GetValueOrDefault(g, true)))],
            new ReminderSet(On("class_tomorrow"), On("class_soon"), On("pass_ending"), On("entries_low")),
            quiet,
            studio.Quiet,
            new ReminderSet(studio.Reminders.ClassTomorrowEnabled, studio.Reminders.ClassSoonEnabled, studio.Reminders.PassEndingEnabled, studio.Reminders.EntriesLowEnabled),
            studio.TimeZone,
            version);
    }

    private static async Task<NotificationSettingsView> ReadSettingsAsync(UnitOfWork unitOfWork, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT o.time_zone,
                   coalesce(s.quiet_starts_local, '22:00'), coalesce(s.quiet_ends_local, '08:00'),
                   coalesce(s.class_tomorrow_enabled, true), coalesce(s.class_tomorrow_send_at, '18:00'),
                   coalesce(s.class_soon_enabled, true), coalesce(s.class_soon_hours_before, 2),
                   coalesce(s.pass_ending_enabled, true), coalesce(s.pass_ending_days_before, 7),
                   coalesce(s.entries_low_enabled, true), coalesce(s.entries_low_left, 1),
                   coalesce(s.version, 0)
            FROM organizations.organizations o
            LEFT JOIN notifications.studio_settings s ON s.organization_id = o.id
            WHERE o.id = $1
            """,
            organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return new NotificationSettingsView(
            new QuietWindow(await reader.GetFieldValueAsync<TimeOnly>(1, cancellationToken), await reader.GetFieldValueAsync<TimeOnly>(2, cancellationToken)),
            new ReminderTimingView(
                reader.GetBoolean(3),
                await reader.GetFieldValueAsync<TimeOnly>(4, cancellationToken),
                reader.GetBoolean(5),
                reader.GetInt32(6),
                reader.GetBoolean(7),
                reader.GetInt32(8),
                reader.GetBoolean(9),
                reader.GetInt32(10)),
            reader.GetString(0),
            reader.GetInt32(11));
    }

    private static async Task<long> VersionAsync(UnitOfWork unitOfWork, Guid organizationId, Guid person, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT version FROM notifications.preference_versions WHERE organization_id = $1 AND person_id = $2",
            organizationId, person);
        return await command.ExecuteScalarAsync(cancellationToken) is int version ? version : 0;
    }

    /// <summary>Preferences belong to the caller's person record in this studio; staff without one have none.</summary>
    private static async Task<Guid> MyPersonAsync(UnitOfWork unitOfWork, TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command("SELECT id FROM people.people WHERE organization_id = $1 AND membership_id = $2", tenant.OrganizationId, tenant.MembershipId);
        return await command.ExecuteScalarAsync(cancellationToken) as Guid?
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "person.not_found", "You have no member record in this studio.");
    }

    private static void Range(int value, int min, int max, string field)
    {
        if (value < min || value > max)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", $"Use {min} to {max}.", field);
        }
    }

    private static DomainRuleViolationException QuietInvalid() =>
        new(ViolationKind.Validation, "quietHours.invalid", "Quiet hours need two different times.", "quietHours");

    private static DomainRuleViolationException Conflict() =>
        new(ViolationKind.Conflict, "concurrency.conflict", "Someone changed this in the meantime. Reload and try again.");

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}

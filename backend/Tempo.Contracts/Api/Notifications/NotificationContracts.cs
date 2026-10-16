namespace Tempo.Contracts.Api.Notifications;

/// <summary>`QuietHours` in contracts/openapi/tempo-api.v1.yaml (docs/30 section 7); times are `HH:MM`.</summary>
public sealed record QuietHoursDto(string? StartsLocal, string? EndsLocal);

/// <summary>`NotificationChannels`.</summary>
public sealed record NotificationChannelsDto(bool? Inbox, bool? Push);

/// <summary>`NotificationGroupPreference`.</summary>
public sealed record NotificationGroupPreferenceDto(string? Group, NotificationChannelsDto? Channels);

/// <summary>`ReminderSwitches`.</summary>
public sealed record ReminderSwitchesDto(bool? ClassTomorrow, bool? ClassSoon, bool? PassEnding, bool? EntriesLow);

/// <summary>`NotificationPreferences`.</summary>
public sealed record NotificationPreferencesResponse(
    IReadOnlyList<NotificationGroupPreferenceDto> Groups,
    ReminderSwitchesDto Reminders,
    QuietHoursDto? QuietHours,
    QuietHoursDto StudioQuietHours,
    ReminderSwitchesDto StudioReminders,
    string TimeZone,
    string Version);

/// <summary>`NotificationPreferencesInput`.</summary>
public sealed record NotificationPreferencesInput(IReadOnlyList<NotificationGroupPreferenceDto>? Groups, ReminderSwitchesDto? Reminders, QuietHoursDto? QuietHours);

public sealed record ClassTomorrowTimingDto(bool? Enabled, string? SendAtLocal);

public sealed record ClassSoonTimingDto(bool? Enabled, int? HoursBefore);

public sealed record PassEndingTimingDto(bool? Enabled, int? DaysBefore);

public sealed record EntriesLowTimingDto(bool? Enabled, int? EntriesLeft);

/// <summary>`ReminderTiming`.</summary>
public sealed record ReminderTimingDto(ClassTomorrowTimingDto? ClassTomorrow, ClassSoonTimingDto? ClassSoon, PassEndingTimingDto? PassEnding, EntriesLowTimingDto? EntriesLow);

/// <summary>`NotificationSettings`.</summary>
public sealed record NotificationSettingsResponse(QuietHoursDto QuietHours, ReminderTimingDto Reminders, string TimeZone, string Version);

/// <summary>`NotificationSettingsInput`.</summary>
public sealed record NotificationSettingsInput(QuietHoursDto? QuietHours, ReminderTimingDto? Reminders);

/// <summary>`PushSubscription`: never the endpoint or the keys.</summary>
public sealed record PushSubscriptionResponse(Guid Id, string DeviceLabel, DateTimeOffset CreatedAt, DateTimeOffset? LastSuccessAt);

/// <summary>`PushSubscriptionList`.</summary>
public sealed record PushSubscriptionListResponse(IReadOnlyList<PushSubscriptionResponse> Items);

public sealed record PushSubscriptionKeysDto(string? P256dh, string? Auth);

/// <summary>`CreatePushSubscriptionRequest`: the browser's `PushSubscription.toJSON()` plus a label.</summary>
public sealed record CreatePushSubscriptionRequest(string? Endpoint, PushSubscriptionKeysDto? Keys, string? DeviceLabel);

/// <summary>`VapidPublicKey`.</summary>
public sealed record VapidPublicKeyResponse(string PublicKey);

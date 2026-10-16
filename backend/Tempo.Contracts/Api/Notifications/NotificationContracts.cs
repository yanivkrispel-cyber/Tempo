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

/// <summary>`NotificationTemplateList` row: a templated kind and the channels the studio words itself (docs/30 step 7).</summary>
public sealed record NotificationTemplateSummaryDto(string Kind, string Group, IReadOnlyList<string> Customized, DateTimeOffset? UpdatedAt);

/// <summary>`NotificationTemplateList`.</summary>
public sealed record NotificationTemplateListResponse(IReadOnlyList<NotificationTemplateSummaryDto> Items);

public sealed record TemplatePreviewDto(string Subject, string Body);

/// <summary>`TemplateText`: the words in use for one channel, where they come from and their preview.</summary>
public sealed record TemplateTextResponse(string Subject, string Body, string Source, int? StudioVersion, TemplatePreviewDto Preview);

public sealed record NotificationTemplateChannelsResponse(TemplateTextResponse Inbox, TemplateTextResponse Push);

/// <summary>`NotificationTemplate`.</summary>
public sealed record NotificationTemplateResponse(
    string Kind,
    string Group,
    string Locale,
    IReadOnlyList<string> Variables,
    IReadOnlyDictionary<string, string> SampleValues,
    NotificationTemplateChannelsResponse Channels,
    string Version);

/// <summary>`TemplateTextInput`.</summary>
public sealed record TemplateTextInputDto(string? Subject, string? Body);

/// <summary>`NotificationTemplateInput`: null for a channel goes back to the platform default.</summary>
public sealed record NotificationTemplateInput(string? Locale, TemplateTextInputDto? Inbox, TemplateTextInputDto? Push);

/// <summary>`AnnouncementAllowance`.</summary>
public sealed record AnnouncementAllowanceResponse(int Recipients, int MaxRecipients, int SentToday, int DailyLimit);

/// <summary>`AnnouncementInput`.</summary>
public sealed record AnnouncementInput(string? Subject, string? Body);

/// <summary>`Announcement`.</summary>
public sealed record AnnouncementResponse(Guid Id, int Recipients, DateTimeOffset SentAt, int SentToday, int DailyLimit);

/// <summary>`Delivery`: never the text or the address.</summary>
public sealed record DeliveryResponse(Guid Id, string Kind, string Channel, string Status, string? Reason, int Attempts, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

/// <summary>`DeliveryList`.</summary>
public sealed record DeliveryListResponse(IReadOnlyList<DeliveryResponse> Items);

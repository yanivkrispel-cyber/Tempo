using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Notifications;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Notifications.Application;
using Tempo.Platform.Modules.Notifications.Domain;
using Tempo.Platform.Modules.Notifications.Infrastructure;

namespace Tempo.Api.Endpoints;

/// <summary>
/// A member's notification preferences and the studio's quiet hours and reminder timing (docs/30 sections 7 and
/// 9), the member's push devices and the environment's VAPID public key (section 4.3).
/// </summary>
public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotificationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/me/notification-preferences", GetMineAsync).RequirePermission(Permissions.OrganizationView).WithName("getMyNotificationPreferences").Produces<NotificationPreferencesResponse>();
        tenant.MapPut("/me/notification-preferences", UpdateMineAsync).RequirePermission(Permissions.OrganizationView).WithName("updateMyNotificationPreferences").Produces<NotificationPreferencesResponse>();
        tenant.MapGet("/notification-settings", GetSettingsAsync).RequirePermission(Permissions.OrganizationView).WithName("getNotificationSettings").Produces<NotificationSettingsResponse>();
        tenant.MapPut("/notification-settings", UpdateSettingsAsync).RequirePermission(Permissions.OrganizationSettingsManage).WithName("updateNotificationSettings").Produces<NotificationSettingsResponse>();
        tenant.MapGet("/me/push-subscriptions", ListDevicesAsync).RequirePermission(Permissions.OrganizationView).WithName("listMyPushSubscriptions").Produces<PushSubscriptionListResponse>();
        tenant.MapPost("/me/push-subscriptions", CreateDeviceAsync).RequirePermission(Permissions.OrganizationView).WithName("createMyPushSubscription").Produces<PushSubscriptionResponse>(StatusCodes.Status201Created);
        tenant.MapDelete("/me/push-subscriptions/{subscriptionId:guid}", DeleteDeviceAsync).RequirePermission(Permissions.OrganizationView).WithName("deleteMyPushSubscription").Produces(StatusCodes.Status204NoContent);
        endpoints.MapAccountGroup().MapGet("/push/vapid-public-key", VapidPublicKeyAsync).WithName("getVapidPublicKey").Produces<VapidPublicKeyResponse>();

        return endpoints;
    }

    private static async Task<IResult> GetMineAsync(HttpContext httpContext, INotificationPreferencesService preferences) =>
        Results.Ok(ToResponse(await preferences.GetMineAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdateMineAsync(
        HttpContext httpContext,
        NotificationPreferencesInput request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        INotificationPreferencesService preferences)
    {
        var groups = (request.Groups ?? throw Required("groups"))
            .Select(g =>
            {
                var channels = g.Channels ?? throw Required("groups");
                return new GroupChannels(g.Group ?? throw Required("groups"), channels.Inbox ?? throw Required("groups"), channels.Push ?? throw Required("groups"));
            })
            .ToList();
        var r = request.Reminders ?? throw Required("reminders");
        var change = new NotificationPreferencesChange(
            groups,
            new ReminderSet(
                r.ClassTomorrow ?? throw Required("reminders"),
                r.ClassSoon ?? throw Required("reminders"),
                r.PassEnding ?? throw Required("reminders"),
                r.EntriesLow ?? throw Required("reminders")),
            request.QuietHours is { } q ? Window(q) : null);
        var updated = await preferences.UpdateMineAsync(TenantRouteFilter.Current(httpContext), change, OrganizationEndpoints.ParseVersion(ifMatch), httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> GetSettingsAsync(HttpContext httpContext, INotificationPreferencesService preferences) =>
        Results.Ok(ToResponse(await preferences.GetSettingsAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdateSettingsAsync(
        HttpContext httpContext,
        NotificationSettingsInput request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        INotificationPreferencesService preferences)
    {
        var quiet = Window(request.QuietHours ?? throw Required("quietHours"));
        var r = request.Reminders ?? throw Required("reminders");
        var tomorrow = r.ClassTomorrow ?? throw Required("reminders.classTomorrow");
        var soon = r.ClassSoon ?? throw Required("reminders.classSoon");
        var ending = r.PassEnding ?? throw Required("reminders.passEnding");
        var low = r.EntriesLow ?? throw Required("reminders.entriesLow");
        var timing = new ReminderTimingView(
            tomorrow.Enabled ?? throw Required("reminders.classTomorrow.enabled"),
            Time(tomorrow.SendAtLocal ?? throw Required("reminders.classTomorrow.sendAtLocal"), "reminders.classTomorrow.sendAtLocal"),
            soon.Enabled ?? throw Required("reminders.classSoon.enabled"),
            soon.HoursBefore ?? throw Required("reminders.classSoon.hoursBefore"),
            ending.Enabled ?? throw Required("reminders.passEnding.enabled"),
            ending.DaysBefore ?? throw Required("reminders.passEnding.daysBefore"),
            low.Enabled ?? throw Required("reminders.entriesLow.enabled"),
            low.EntriesLeft ?? throw Required("reminders.entriesLow.entriesLeft"));
        var updated = await preferences.UpdateSettingsAsync(TenantRouteFilter.Current(httpContext), quiet, timing, OrganizationEndpoints.ParseVersion(ifMatch), httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> ListDevicesAsync(HttpContext httpContext, IPushSubscriptionService devices) =>
        Results.Ok(new PushSubscriptionListResponse([.. (await devices.ListMineAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> CreateDeviceAsync(HttpContext httpContext, CreatePushSubscriptionRequest request, IPushSubscriptionService devices)
    {
        var (subscription, created) = await devices.CreateMineAsync(
            TenantRouteFilter.Current(httpContext),
            request.Endpoint ?? throw Required("endpoint"),
            request.Keys?.P256dh ?? throw Required("keys"),
            request.Keys.Auth ?? throw Required("keys"),
            request.DeviceLabel ?? throw Required("deviceLabel"),
            httpContext.RequestAborted);
        return created ? Results.Created((string?)null, ToResponse(subscription)) : Results.Ok(ToResponse(subscription));
    }

    private static async Task<IResult> DeleteDeviceAsync(HttpContext httpContext, Guid subscriptionId, IPushSubscriptionService devices)
    {
        await devices.DeleteMineAsync(TenantRouteFilter.Current(httpContext), subscriptionId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static async Task<IResult> VapidPublicKeyAsync(HttpContext httpContext, VapidKeySource keys) =>
        await keys.GetAsync(httpContext.RequestAborted) is { } pair
            ? Results.Ok(new VapidPublicKeyResponse(pair.PublicKey))
            : throw new DomainRuleViolationException(ViolationKind.NotFound, "push.unavailable", "Push is not set up in this environment yet.");

    private static PushSubscriptionResponse ToResponse(PushSubscriptionView s) => new(s.Id, s.DeviceLabel, s.CreatedAt, s.LastSuccessAt);

    private static NotificationPreferencesResponse ToResponse(NotificationPreferencesView p) =>
        new(
            [.. p.Groups.Select(g => new NotificationGroupPreferenceDto(g.Group, new NotificationChannelsDto(g.Inbox, g.Push)))],
            ToDto(p.Reminders),
            p.Quiet is { } quiet ? ToDto(quiet) : null,
            ToDto(p.StudioQuiet),
            ToDto(p.StudioReminders),
            p.TimeZone,
            p.Version.ToString(CultureInfo.InvariantCulture));

    private static NotificationSettingsResponse ToResponse(NotificationSettingsView s) =>
        new(
            ToDto(s.Quiet),
            new ReminderTimingDto(
                new ClassTomorrowTimingDto(s.Reminders.ClassTomorrowEnabled, Format(s.Reminders.ClassTomorrowSendAt)),
                new ClassSoonTimingDto(s.Reminders.ClassSoonEnabled, s.Reminders.ClassSoonHoursBefore),
                new PassEndingTimingDto(s.Reminders.PassEndingEnabled, s.Reminders.PassEndingDaysBefore),
                new EntriesLowTimingDto(s.Reminders.EntriesLowEnabled, s.Reminders.EntriesLowLeft)),
            s.TimeZone,
            s.Version.ToString(CultureInfo.InvariantCulture));

    private static ReminderSwitchesDto ToDto(ReminderSet r) => new(r.ClassTomorrow, r.ClassSoon, r.PassEnding, r.EntriesLow);

    private static QuietHoursDto ToDto(QuietWindow q) => new(Format(q.Starts), Format(q.Ends));

    private static string Format(TimeOnly time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);

    private static QuietWindow Window(QuietHoursDto q) =>
        new(Time(q.StartsLocal ?? throw Required("quietHours.startsLocal"), "quietHours.startsLocal"),
            Time(q.EndsLocal ?? throw Required("quietHours.endsLocal"), "quietHours.endsLocal"));

    private static TimeOnly Time(string value, string field) =>
        TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)
            ? time
            : throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", "Use HH:MM, e.g. 22:00.", field);

    private static DomainRuleViolationException Required(string field) =>
        new(ViolationKind.Validation, $"{field}.required", "This field is required.", field);
}

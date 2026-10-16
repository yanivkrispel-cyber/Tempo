using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Running one class (roster, attendance, edit, cancel), the booking policy and the in-app inbox
/// (docs/29 sections 4.2, 6.1, 6.4 and 9). Roster and attendance declare `schedule.view` because the
/// session's own instructor may use them; the service checks staff permission or instructor.
/// </summary>
public static class ClassEndpoints
{
    public static IEndpointRouteBuilder MapClassEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/sessions/{sessionId:guid}/roster", RosterAsync).RequirePermission(Permissions.ScheduleView).WithName("getSessionRoster").Produces<RosterResponse>();
        tenant.MapPost("/bookings/{bookingId:guid}/attendance", AttendanceAsync).RequirePermission(Permissions.ScheduleView).WithName("markAttendance").Produces<BookingResponse>();
        tenant.MapPatch("/sessions/{sessionId:guid}", UpdateSessionAsync).RequirePermission(Permissions.ScheduleManage).WithName("updateSession").Produces<SessionResponse>();
        tenant.MapPost("/sessions/{sessionId:guid}/messages", SendMessageAsync).RequirePermission(Permissions.ScheduleView).WithName("sendSessionMessage").Produces<SessionMessageResponse>(StatusCodes.Status202Accepted);
        tenant.MapPost("/sessions/{sessionId:guid}/cancel", CancelSessionAsync).RequirePermission(Permissions.ScheduleManage).WithName("cancelSession").Produces<SessionResponse>();
        tenant.MapGet("/booking-policy", GetPolicyAsync).RequirePermission(Permissions.ScheduleView).WithName("getBookingPolicy").Produces<BookingPolicyResponse>();
        tenant.MapPut("/booking-policy", UpdatePolicyAsync).RequirePermission(Permissions.ScheduleManage).WithName("updateBookingPolicy").Produces<BookingPolicyResponse>();
        tenant.MapGet("/me/notifications", ListInboxAsync).RequirePermission(Permissions.OrganizationView).WithName("listMyNotifications").Produces<InboxPageResponse>();
        tenant.MapPost("/me/notifications/read-all", MarkAllReadAsync).RequirePermission(Permissions.OrganizationView).WithName("markAllNotificationsRead").Produces(StatusCodes.Status204NoContent);
        tenant.MapPost("/me/notifications/{itemId:guid}/read", MarkReadAsync).RequirePermission(Permissions.OrganizationView).WithName("markNotificationRead").Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> RosterAsync(HttpContext httpContext, Guid sessionId, IClassService classes)
    {
        var roster = await classes.RosterAsync(TenantRouteFilter.Current(httpContext), sessionId, httpContext.RequestAborted);
        return Results.Ok(new RosterResponse(ScheduleEndpoints.ToResponse(roster.Session), [.. roster.Booked.Select(ToResponse)], [.. roster.Waitlisted.Select(ToResponse)]));
    }

    private static async Task<IResult> AttendanceAsync(HttpContext httpContext, Guid bookingId, AttendanceRequest request, IClassService classes) =>
        Results.Ok(BookingEndpoints.ToResponse(await classes.MarkAttendanceAsync(TenantRouteFilter.Current(httpContext), bookingId, request.State ?? string.Empty, httpContext.RequestAborted)));

    private static async Task<IResult> UpdateSessionAsync(
        HttpContext httpContext,
        Guid sessionId,
        [FromBody] JsonElement body,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IClassService classes)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "request.invalid", "Send a JSON object.");
        }

        var changes = new SessionChanges(
            NullableGuid(body, "instructorMembershipId"),
            NullableGuid(body, "roomId"),
            body.TryGetProperty("capacity", out var capacity) && capacity.ValueKind == JsonValueKind.Number && capacity.TryGetInt32(out var c) ? c : null);
        var updated = await classes.UpdateSessionAsync(TenantRouteFilter.Current(httpContext), sessionId, changes, OrganizationEndpoints.ParseVersion(ifMatch), httpContext.RequestAborted);
        return Results.Ok(ScheduleEndpoints.ToResponse(updated));
    }

    private static async Task<IResult> CancelSessionAsync(HttpContext httpContext, Guid sessionId, IClassService classes) =>
        Results.Ok(ScheduleEndpoints.ToResponse(await classes.CancelSessionAsync(TenantRouteFilter.Current(httpContext), sessionId, httpContext.RequestAborted)));

    private static async Task<IResult> GetPolicyAsync(HttpContext httpContext, IStudioSettingsService settings) =>
        Results.Ok(ToResponse(await settings.GetPolicyAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdatePolicyAsync(
        HttpContext httpContext,
        BookingPolicyInput request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IStudioSettingsService settings)
    {
        var policy = new BookingPolicyView(
            request.FreeCancelHours ?? throw Required("freeCancelHours"),
            request.WaitlistCutoffHours ?? throw Required("waitlistCutoffHours"),
            request.BookingHorizonDays ?? throw Required("bookingHorizonDays"),
            request.WaitlistEnabled ?? throw Required("waitlistEnabled"),
            0);
        var updated = await settings.UpdatePolicyAsync(TenantRouteFilter.Current(httpContext), policy, OrganizationEndpoints.ParseVersion(ifMatch), httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> SendMessageAsync(HttpContext httpContext, Guid sessionId, SendSessionMessageRequest request, ISessionMessageService messages)
    {
        var sent = await messages.SendAsync(TenantRouteFilter.Current(httpContext), sessionId, request.Text, httpContext.RequestAborted);
        return Results.Accepted(null, new SessionMessageResponse(sent.Id, sent.SessionId, sent.Recipients, sent.CreatedAt));
    }

    private static async Task<IResult> ListInboxAsync(HttpContext httpContext, Guid? before, int? limit, IStudioSettingsService settings)
    {
        var page = await settings.ListInboxAsync(TenantRouteFilter.Current(httpContext), before, limit ?? 50, httpContext.RequestAborted);
        return Results.Ok(new InboxPageResponse(
            [.. page.Items.Select(i => new InboxItemResponse(
                i.Id,
                i.Kind,
                new InboxItemDataResponse(i.SessionId, i.BookingId),
                i.CreatedAt,
                i.ReadAt,
                i.SessionId is { } id && i.SessionStartsAt is { } at ? new InboxSessionResponse(id, at, i.ClassTypeName ?? "") : null,
                i.Text))],
            page.UnreadCount,
            page.NextBefore));
    }

    private static async Task<IResult> MarkReadAsync(HttpContext httpContext, Guid itemId, IStudioSettingsService settings)
    {
        await settings.MarkReadAsync(TenantRouteFilter.Current(httpContext), itemId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static async Task<IResult> MarkAllReadAsync(HttpContext httpContext, IStudioSettingsService settings)
    {
        await settings.MarkAllReadAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static RosterEntryResponse ToResponse(RosterEntryView e) =>
        new(e.BookingId, new PersonRefResponse(e.Person.Id, e.Person.DisplayName), e.Status, e.WaitlistPosition, e.PassName, e.EntriesLeft, e.BookedAt);

    private static BookingPolicyResponse ToResponse(BookingPolicyView p) =>
        new(p.FreeCancelHours, p.WaitlistCutoffHours, p.BookingHorizonDays, p.WaitlistEnabled, p.Version.ToString(CultureInfo.InvariantCulture));

    private static Change<Guid?> NullableGuid(JsonElement body, string name)
    {
        if (!body.TryGetProperty(name, out var e))
        {
            return default;
        }

        if (e.ValueKind == JsonValueKind.Null)
        {
            return new Change<Guid?>(true, null);
        }

        return e.ValueKind == JsonValueKind.String && e.TryGetGuid(out var id)
            ? new Change<Guid?>(true, id)
            : throw new DomainRuleViolationException(ViolationKind.Validation, $"{name}.invalid", "This value has the wrong type.", name);
    }

    private static DomainRuleViolationException Required(string field) =>
        new(ViolationKind.Validation, $"{field}.required", "This field is required.", field);
}

using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Booking, cancelling and the caller's bookings (docs/29 sections 6 and 9). A member books for themselves
/// with `schedule.view` (the self rule); booking for someone else needs `bookings.manage`, checked by the service.
/// </summary>
public static class BookingEndpoints
{
    public static IEndpointRouteBuilder MapBookingEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapPost("/sessions/{sessionId:guid}/bookings", BookAsync).RequirePermission(Permissions.ScheduleView).WithName("createBooking").Produces<BookingResponse>(StatusCodes.Status201Created);
        tenant.MapPost("/bookings/{bookingId:guid}/cancel", CancelAsync).RequirePermission(Permissions.ScheduleView).WithName("cancelBooking").WithMetadata(new AllowWhenSubscriptionRestrictedAttribute()).Produces<BookingResponse>();
        tenant.MapPost("/bookings/{bookingId:guid}/move", MoveAsync).RequirePermission(Permissions.BookingsManage).WithName("moveBooking").Produces<BookingResponse>();
        tenant.MapPost("/bookings/{bookingId:guid}/promote", PromoteAsync).RequirePermission(Permissions.BookingsManage).WithName("promoteBooking").Produces<BookingResponse>();
        tenant.MapGet("/me/bookings/{bookingId:guid}/calendar.ics", CalendarAsync).RequirePermission(Permissions.ScheduleView).WithName("getBookingCalendar").Produces<string>(StatusCodes.Status200OK, "text/calendar");
        tenant.MapGet("/me/bookings", ListMineAsync).RequirePermission(Permissions.ScheduleView).WithName("listMyBookings").Produces<MyBookingPageResponse>();
        tenant.MapGet("/people/{personId:guid}/bookings", ListForPersonAsync).RequirePermission(Permissions.BookingsManage).WithName("listPersonBookings").Produces<MyBookingPageResponse>();

        return endpoints;
    }

    private static async Task<IResult> BookAsync(
        HttpContext httpContext,
        Guid sessionId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CreateBookingRequest? request,
        IBookingService bookings)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var booking = await bookings.BookAsync(tenant, sessionId, request?.PersonId, httpContext.RequestAborted, request?.SpotId, request?.Src);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/bookings/{booking.Id}", ToResponse(booking));
    }

    private static async Task<IResult> CancelAsync(
        HttpContext httpContext,
        Guid bookingId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CancelBookingRequest? request,
        IBookingService bookings) =>
        Results.Ok(ToResponse(await bookings.CancelAsync(TenantRouteFilter.Current(httpContext), bookingId, request?.ReturnEntry == true, httpContext.RequestAborted)));

    private static async Task<IResult> MoveAsync(HttpContext httpContext, Guid bookingId, MoveBookingRequest request, IBookingService bookings)
    {
        var target = request.SessionId ?? throw new DomainRuleViolationException(ViolationKind.Validation, "sessionId.required", "Say which class to move to.", "sessionId");
        return Results.Ok(ToResponse(await bookings.MoveAsync(TenantRouteFilter.Current(httpContext), bookingId, target, httpContext.RequestAborted)));
    }

    private static async Task<IResult> PromoteAsync(
        HttpContext httpContext,
        Guid bookingId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] PromoteBookingRequest? request,
        IBookingService bookings) =>
        Results.Ok(ToResponse(await bookings.PromoteAsync(TenantRouteFilter.Current(httpContext), bookingId, request?.SpotId, httpContext.RequestAborted)));

    /// <summary>"Add to calendar" (docs/29 section 16.3): one .ics file for the caller's own booked place.</summary>
    private static async Task<IResult> CalendarAsync(HttpContext httpContext, Guid bookingId, IBookingCalendarService calendars)
    {
        var file = await calendars.CalendarAsync(TenantRouteFilter.Current(httpContext), bookingId, httpContext.RequestAborted);
        httpContext.Response.Headers.ContentDisposition = $"attachment; filename=\"{file.FileName}\"";
        return Results.Text(file.Content, "text/calendar; charset=utf-8");
    }

    private static async Task<IResult> ListMineAsync(HttpContext httpContext, string? scope, Guid? before, int? limit, IBookingService bookings)
    {
        var page = await bookings.ListMineAsync(TenantRouteFilter.Current(httpContext), Upcoming(scope), before, limit ?? 50, httpContext.RequestAborted);
        return Results.Ok(ToResponse(page));
    }

    private static async Task<IResult> ListForPersonAsync(HttpContext httpContext, Guid personId, string? scope, Guid? before, int? limit, IBookingService bookings)
    {
        var page = await bookings.ListForPersonAsync(TenantRouteFilter.Current(httpContext), personId, Upcoming(scope), before, limit ?? 50, httpContext.RequestAborted);
        return Results.Ok(ToResponse(page));
    }

    private static bool Upcoming(string? scope) => scope switch
    {
        null or "upcoming" => true,
        "past" => false,
        _ => throw new DomainRuleViolationException(ViolationKind.Validation, "scope.invalid", "Use upcoming or past.", "scope")
    };

    private static MyBookingPageResponse ToResponse(MyBookingPage page) =>
        new(
            [.. page.Items.Select(i =>
            {
                var b = ToResponse(i.Booking);
                return new MyBookingResponse(b.Id, b.SessionId, b.Person, b.Status, b.WaitlistPosition, b.LateCancel, b.CancelReason, b.Pass, b.CreatedAt, b.Version, ScheduleEndpoints.ToResponse(i.Session), b.CancelledFrom, b.Spot);
            })],
            page.NextBefore);

    internal static BookingResponse ToResponse(BookingView b) =>
        new(
            b.Id,
            b.SessionId,
            new PersonRefResponse(b.Person.Id, b.Person.DisplayName),
            b.Status,
            b.WaitlistPosition,
            b.LateCancel,
            b.CancelReason,
            b.Pass is { } p ? new PassSummaryResponse(p.Id, p.Name, p.Kind, p.EndsOn, p.EntriesLeft) : null,
            b.CreatedAt,
            b.Version.ToString(CultureInfo.InvariantCulture),
            b.CancelledFrom,
            b.Spot is { } spot ? new SpotRefResponse(spot.Id, spot.Label) : null,
            b.ToPayAtStudio);
}

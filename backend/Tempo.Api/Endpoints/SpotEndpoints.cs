using System.Globalization;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Rooms with spots (docs/33 section 3): the room's layout, the map of one class, the spot of a booking and the
/// caller's usual spot. Who may change a booking's spot is checked by the service (the booking's owner before the
/// class, or `bookings.manage`).
/// </summary>
public static class SpotEndpoints
{
    public static IEndpointRouteBuilder MapSpotEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/rooms/{roomId:guid}/layout", LayoutAsync).RequirePermission(Permissions.ScheduleView).WithName("getRoomLayout").Produces<RoomLayoutResponse>();
        tenant.MapPut("/rooms/{roomId:guid}/layout", SaveLayoutAsync).RequirePermission(Permissions.ScheduleManage).WithName("saveRoomLayout").Produces<RoomLayoutResponse>();
        tenant.MapGet("/sessions/{sessionId:guid}/spots", SessionSpotsAsync).RequirePermission(Permissions.ScheduleView).WithName("getSessionSpots").Produces<SessionSpotsResponse>();
        tenant.MapPut("/bookings/{bookingId:guid}/spot", ChangeSpotAsync).RequirePermission(Permissions.ScheduleView).WithName("changeBookingSpot").Produces<BookingResponse>();
        tenant.MapPut("/me/spot-preferences/{roomId:guid}", SetUsualSpotAsync).RequirePermission(Permissions.ScheduleView).WithName("setUsualSpot").Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> LayoutAsync(HttpContext httpContext, Guid roomId, ISpotService spots) =>
        Results.Ok(ToResponse(await spots.LayoutAsync(TenantRouteFilter.Current(httpContext), roomId, httpContext.RequestAborted)));

    private static async Task<IResult> SaveLayoutAsync(HttpContext httpContext, Guid roomId, RoomLayoutRequest request, ISpotService spots)
    {
        var input = new RoomLayoutInput(
            request.SpotSelection ?? false,
            request.Rows,
            request.Cols,
            request.WindowSide,
            request.MirrorFront ?? false,
            [.. (request.Spots ?? []).Select(s => new SpotInput(s.Id, s.Label, s.Row, s.Col, s.Kind, s.Status))]);
        return Results.Ok(ToResponse(await spots.SaveLayoutAsync(TenantRouteFilter.Current(httpContext), roomId, input, httpContext.RequestAborted)));
    }

    private static async Task<IResult> SessionSpotsAsync(HttpContext httpContext, Guid sessionId, ISpotService spots)
    {
        var map = await spots.SessionSpotsAsync(TenantRouteFilter.Current(httpContext), sessionId, httpContext.RequestAborted);
        return Results.Ok(new SessionSpotsResponse(
            map.SessionId,
            map.RoomId,
            map.SpotSelection,
            map.Rows,
            map.Cols,
            map.WindowSide,
            map.MirrorFront,
            map.MySpotId,
            map.UsualSpotId,
            [.. map.Spots.Select(s => new SessionSpotResponse(
                s.Id, s.Label, s.Row, s.Col, s.Kind, s.State, s.BookingId,
                s.Person is { } p ? new PersonRefResponse(p.Id, p.DisplayName, MediaLinks.Url(s.AvatarMediaId, small: true)) : null,
                s.Attendance, s.HealthStatus))]));
    }

    private static async Task<IResult> ChangeSpotAsync(HttpContext httpContext, Guid bookingId, ChangeSpotRequest request, ISpotService spots)
    {
        var spotId = request.SpotId ?? throw new DomainRuleViolationException(ViolationKind.Validation, "spotId.required", "Say which spot.", "spotId");
        return Results.Ok(BookingEndpoints.ToResponse(await spots.ChangeSpotAsync(TenantRouteFilter.Current(httpContext), bookingId, spotId, httpContext.RequestAborted)));
    }

    private static async Task<IResult> SetUsualSpotAsync(HttpContext httpContext, Guid roomId, UsualSpotRequest request, ISpotService spots)
    {
        await spots.SetUsualSpotAsync(TenantRouteFilter.Current(httpContext), roomId, request.SpotId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static RoomLayoutResponse ToResponse(RoomLayoutView layout) =>
        new(
            layout.RoomId,
            layout.SpotSelection,
            layout.Rows,
            layout.Cols,
            layout.WindowSide,
            layout.MirrorFront,
            [.. layout.Spots.Select(s => new RoomSpotResponse(s.Id, s.Label, s.Row, s.Col, s.Kind, s.Status))],
            layout.Version.ToString(CultureInfo.InvariantCulture));
}

using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Check-in at the door (docs/33 section 8): the member reads their rotating code, staff (or the class's instructor)
/// scan it. The scan's permission is checked by the service against the class the code opens.
/// </summary>
public static class CheckinEndpoints
{
    public static IEndpointRouteBuilder MapCheckinEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/me/checkin-code", MyCodeAsync).RequirePermission(Permissions.ScheduleView).WithName("getMyCheckinCode").Produces<CheckinCodeResponse>();
        tenant.MapPost("/checkins", CheckInAsync).RequirePermission(Permissions.ScheduleView).WithName("checkIn").Produces<CheckinResponse>();

        return endpoints;
    }

    private static async Task<IResult> MyCodeAsync(HttpContext httpContext, ICheckinService checkins)
    {
        var code = await checkins.MyCodeAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.Ok(new CheckinCodeResponse(code.Code, code.ValidForSeconds, ToResponse(code.OpenClass), ToResponse(code.NextClass)));
    }

    private static async Task<IResult> CheckInAsync(HttpContext httpContext, CheckinRequest request, ICheckinService checkins)
    {
        var done = await checkins.CheckInAsync(TenantRouteFilter.Current(httpContext), request.Code, request.SessionId, httpContext.RequestAborted);
        return Results.Ok(new CheckinResponse(
            done.BookingId,
            done.SessionId,
            new PersonRefResponse(done.Person.Id, done.Person.DisplayName, MediaLinks.Url(done.AvatarMediaId, small: true)),
            done.SpotLabel,
            done.HealthStatus,
            done.AlreadyCheckedIn));
    }

    private static CheckinClassResponse? ToResponse(CheckinClassView? c) =>
        c is null ? null : new CheckinClassResponse(c.SessionId, c.BookingId, c.ClassName, c.StartsAt, c.OpensAt, c.SpotLabel);
}

using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The member's own progress (docs/31 section 12): visits this month, the monthly goal and the streak. Self
/// routes, so `schedule.view` is enough (every role holds it), as for the caller's own bookings.
/// </summary>
public static class ProgressEndpoints
{
    public static IEndpointRouteBuilder MapProgressEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/me/progress", GetAsync).RequirePermission(Permissions.ScheduleView).WithName("getMyProgress").Produces<MyProgressResponse>();
        tenant.MapPut("/me/progress/goal", SetGoalAsync).RequirePermission(Permissions.ScheduleView).WithName("setMyMonthlyGoal").Produces<MyProgressResponse>();

        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, IProgressService progress) =>
        Results.Ok(ToResponse(await progress.GetMineAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> SetGoalAsync(HttpContext httpContext, MonthlyGoalRequest request, IProgressService progress) =>
        Results.Ok(ToResponse(await progress.SetMyGoalAsync(TenantRouteFilter.Current(httpContext), request.MonthlyGoal, httpContext.RequestAborted)));

    private static MyProgressResponse ToResponse(ProgressView view) =>
        new(view.Month, view.TimeZone, view.VisitsThisMonth, view.MonthlyGoal, view.StreakWeeks);
}

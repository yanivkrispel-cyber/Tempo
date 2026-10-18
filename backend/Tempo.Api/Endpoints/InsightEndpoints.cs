using System.Globalization;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The owner's console at a glance (docs/33 section 9): sales, occupancy, suggestions and activity need
/// `reports.view`; search needs `schedule.view`. The service adds `people.view` wherever names appear.
/// </summary>
public static class InsightEndpoints
{
    public static IEndpointRouteBuilder MapInsightEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/insights/sales", SalesAsync).RequirePermission(Permissions.ReportsView).WithName("getSales").Produces<SalesResponse>();
        tenant.MapGet("/insights/occupancy", OccupancyAsync).RequirePermission(Permissions.ReportsView).WithName("getOccupancy").Produces<OccupancyResponse>();
        tenant.MapGet("/insights/suggestions", SuggestionsAsync).RequirePermission(Permissions.ReportsView).WithName("listSuggestions").Produces<SuggestionListResponse>();
        tenant.MapGet("/insights/activity", ActivityAsync).RequirePermission(Permissions.ReportsView).WithName("listActivity").Produces<ActivityListResponse>();
        tenant.MapGet("/search", SearchAsync).RequirePermission(Permissions.ScheduleView).WithName("search").Produces<SearchResponse>();

        return endpoints;
    }

    private static async Task<IResult> SalesAsync(HttpContext httpContext, string? month, IInsightService insights)
    {
        var sales = await insights.SalesAsync(TenantRouteFilter.Current(httpContext), month, httpContext.RequestAborted);
        return Results.Ok(new SalesResponse(
            sales.Month, sales.TimeZone, sales.SoFarAgorot, sales.PreviousToDateAgorot, sales.ForecastAgorot, sales.PassesSold, sales.UnpricedCount,
            [.. sales.Days.Select(d => new SalesDayResponse(d.Day, d.CumulativeAgorot))]));
    }

    private static async Task<IResult> OccupancyAsync(HttpContext httpContext, string? week, IInsightService insights)
    {
        DateOnly? day = null;
        if (week is not null)
        {
            day = DateOnly.TryParseExact(week, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
                ? parsed
                : throw new DomainRuleViolationException(ViolationKind.Validation, "week.invalid", "Use yyyy-MM-dd.", "week");
        }

        var occupancy = await insights.OccupancyAsync(TenantRouteFilter.Current(httpContext), day, httpContext.RequestAborted);
        return Results.Ok(new OccupancyResponse(
            occupancy.WeekStart, occupancy.TimeZone, occupancy.Places, occupancy.Capacity, occupancy.PreviousPlaces, occupancy.PreviousCapacity,
            [.. occupancy.Cells.Select(c => new OccupancyCellResponse(c.Day, c.Part, c.Places, c.Capacity, c.FullWithWaitlist))]));
    }

    private static async Task<IResult> SuggestionsAsync(HttpContext httpContext, IInsightService insights)
    {
        var cards = await insights.SuggestionsAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.Ok(new SuggestionListResponse([.. cards.Select(c => new SuggestionResponse(
            c.Kind,
            c.Count,
            [.. c.People.Select(p => new PersonRefResponse(p.Id, p.DisplayName))],
            c.AmountAgorot,
            c.SessionId,
            c.ClassName,
            c.StartsAt,
            c.InstructorMembershipId,
            c.InstructorName,
            c.Slot is { } s ? new SuggestedSlotResponse(s.StartsAt, s.RoomId, s.RoomName) : null))]));
    }

    private static async Task<IResult> ActivityAsync(HttpContext httpContext, int? limit, IInsightService insights)
    {
        var items = await insights.ActivityAsync(TenantRouteFilter.Current(httpContext), limit ?? 20, httpContext.RequestAborted);
        return Results.Ok(new ActivityListResponse([.. items.Select(a => new ActivityResponse(
            a.Kind,
            a.At,
            new PersonRefResponse(a.Person.Id, a.Person.DisplayName, MediaLinks.Url(a.AvatarMediaId, small: true)),
            a.ClassName,
            a.ClassStartsAt,
            a.SpotLabel,
            a.ProductName,
            a.PriceAgorot))]));
    }

    private static async Task<IResult> SearchAsync(HttpContext httpContext, string? q, IInsightService insights)
    {
        var found = await insights.SearchAsync(TenantRouteFilter.Current(httpContext), q, httpContext.RequestAborted);
        return Results.Ok(new SearchResponse(
            [.. found.People.Select(p => new PersonRefResponse(p.Id, p.DisplayName))],
            [.. found.Sessions.Select(s => new SearchSessionResponse(s.Id, s.ClassName, s.StartsAt, s.InstructorName))]));
    }
}

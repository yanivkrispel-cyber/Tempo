using System.Globalization;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Owner reports (docs/32): the summary needs `reports.view`; the two lists name people, so the service also checks
/// `people.view` (R-6). Reads are not audited.
/// </summary>
public static class ReportEndpoints
{
    public static IEndpointRouteBuilder MapReportEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/reports/summary", GetSummaryAsync).RequirePermission(Permissions.ReportsView).WithName("getReportSummary").Produces<ReportSummaryResponse>();
        tenant.MapGet("/reports/passes-ending", ListPassesEndingAsync).RequirePermission(Permissions.ReportsView).WithName("listPassesEnding").Produces<PassesEndingReportResponse>();
        tenant.MapGet("/reports/members-at-risk", ListMembersAtRiskAsync).RequirePermission(Permissions.ReportsView).WithName("listMembersAtRisk").Produces<MembersAtRiskReportResponse>();

        return endpoints;
    }

    private static async Task<IResult> GetSummaryAsync(HttpContext httpContext, string? from, string? to, IReportService reports)
    {
        var summary = await reports.GetSummaryAsync(TenantRouteFilter.Current(httpContext), DateOf(from, "from"), DateOf(to, "to"), httpContext.RequestAborted);
        return Results.Ok(new ReportSummaryResponse(
            summary.Totals.From,
            summary.Totals.To,
            summary.TimeZone,
            ToResponse(summary.Totals),
            ToResponse(summary.Previous),
            [.. summary.Weeks.Select(w => new ReportWeekResponse(w.WeekStart, w.From, w.To, w.Figures.SessionsHeld, w.Figures.Capacity, w.Figures.PlacesBooked, w.Figures.Attended, w.Figures.NoShow, w.Figures.LateCancellations, w.Figures.FillRate))],
            [.. summary.ClassTypes.Select(c => new ReportClassTypeResponse(c.ClassTypeId, c.Name, c.Color, c.Figures.SessionsHeld, c.Figures.Capacity, c.Figures.PlacesBooked, c.Figures.Attended, c.Figures.NoShow, c.Figures.LateCancellations, c.Figures.FillRate))]));
    }

    private static async Task<IResult> ListPassesEndingAsync(HttpContext httpContext, IReportService reports)
    {
        var list = await reports.ListPassesEndingAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.Ok(new PassesEndingReportResponse(
            list.Today,
            [.. list.Items.Select(p => new PassEndingRowResponse(p.PersonId, p.DisplayName, p.PassId, p.ProductName, p.Kind, p.EndsOn, p.EntriesLeft, p.Reason))],
            list.Truncated));
    }

    private static async Task<IResult> ListMembersAtRiskAsync(HttpContext httpContext, IReportService reports)
    {
        var list = await reports.ListMembersAtRiskAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.Ok(new MembersAtRiskReportResponse(
            list.Today,
            [.. list.Items.Select(m => new MemberAtRiskRowResponse(m.PersonId, m.DisplayName, m.LastAttendedOn, m.PassEndsOn))],
            list.Truncated));
    }

    private static ReportTotalsResponse ToResponse(ReportTotals t) =>
        new(t.From, t.To, t.Figures.SessionsHeld, t.Figures.Capacity, t.Figures.PlacesBooked, t.Figures.Attended, t.Figures.NoShow, t.Figures.LateCancellations, t.Figures.FillRate, t.ActiveMembers, t.NewMembers);

    private static DateOnly? DateOf(string? value, string field)
    {
        if (value is null)
        {
            return null;
        }

        return DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : throw new DomainRuleViolationException(ViolationKind.Validation, "report.period_invalid", "Use yyyy-MM-dd.", field);
    }
}

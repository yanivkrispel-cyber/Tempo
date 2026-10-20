using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Marketing;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Marketing;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Studio marketing, stage A (docs/37): the public page settings. Any member of the studio may read whether the page
/// is on (the console's "פרסום" builds links from it); owners and admins change it.
/// </summary>
public static class MarketingEndpoints
{
    public static IEndpointRouteBuilder MapMarketingEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/public-page", GetAsync).RequirePermission(Permissions.OrganizationView).WithName("getPublicPage").Produces<PublicPageResponse>();
        tenant.MapPut("/public-page", UpdateAsync).RequirePermission(Permissions.OrganizationSettingsManage).WithName("updatePublicPage").Produces<PublicPageResponse>();
        // Instructors hold publish.own; the service checks the class is theirs unless the caller holds publish (M-4).
        tenant.MapPost("/marketing/links", CreateLinkAsync).RequirePermission(Permissions.MarketingPublishOwn).WithName("createMarketingLink").Produces<MarketingLinkResponse>(StatusCodes.Status201Created);
        tenant.MapPost("/me/share-link", ShareLinkAsync).RequirePermission(Permissions.ScheduleView).WithName("getMyShareLink").Produces<MarketingLinkResponse>();
        tenant.MapGet("/me/milestones", MilestonesAsync).RequirePermission(Permissions.ScheduleView).WithName("getMyMilestones").Produces<MyMilestonesResponse>();
        tenant.MapGet("/reports/sources", ReportAsync).RequirePermission(Permissions.ReportsView).WithName("getSourceReport").Produces<SourceReportResponse>();

        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext httpContext, IPublicPageService pages) =>
        Results.Ok(ToResponse(await pages.GetAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> UpdateAsync(
        HttpContext httpContext,
        UpdatePublicPageRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        IPublicPageService pages)
    {
        var updated = await pages.UpdateAsync(
            TenantRouteFilter.Current(httpContext),
            new PublicPageChanges(request.Enabled, request.OpenJoin, request.IntroProductId, request.SuggestWeeklyAt, request.InstagramHandle, request.ReferralRewardProductId),
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    private static async Task<IResult> CreateLinkAsync(HttpContext httpContext, CreateMarketingLinkRequest request, IMarketingLinkService links, AppLinks apps)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var link = await links.CreateAsync(tenant, new NewMarketingLink(request.Channel, request.Template, request.SessionId), httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/marketing/links/{link.Id}", LinkResponse(link, apps));
    }

    /// <summary>The members-app address of a link: the class page when it names one, else the studio's page.</summary>
    private static MarketingLinkResponse LinkResponse(MarketingLinkView link, AppLinks apps)
    {
        var path = link.SessionId is { } session ? $"/s/{Uri.EscapeDataString(link.Slug)}/c/{session}" : $"/s/{Uri.EscapeDataString(link.Slug)}/";
        return new MarketingLinkResponse(link.Id, link.Code, link.Channel, link.Template, link.SessionId, new Uri($"{apps.ClientApp}{path}?src={link.Code}"), link.CreatedAt);
    }

    private static async Task<IResult> ShareLinkAsync(HttpContext httpContext, ShareLinkRequest request, IMemberMarketingService members, AppLinks apps)
    {
        var link = await members.ShareLinkAsync(TenantRouteFilter.Current(httpContext), request.Channel, request.SessionId, httpContext.RequestAborted);
        return Results.Ok(LinkResponse(link, apps));
    }

    private static async Task<IResult> MilestonesAsync(HttpContext httpContext, IMemberMarketingService members)
    {
        var m = await members.MilestonesAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.Ok(new MyMilestonesResponse(m.Attended, m.Reached, m.Next, m.HoursOnTheMat, m.LongestWeekStreak, m.UsualTime, m.TopInstructor));
    }

    private static async Task<IResult> ReportAsync(HttpContext httpContext, int? days, IMarketingLinkService links)
    {
        var report = await links.ReportAsync(TenantRouteFilter.Current(httpContext), days ?? 7, httpContext.RequestAborted);
        return Results.Ok(new SourceReportResponse(
            report.Days,
            [.. report.ByChannel.Select(c => new ChannelSourceResponse(c.Channel, c.Counts.Members, c.Counts.Bookings, c.Counts.Attended))],
            [.. report.ByLink.Select(l => new LinkSourceResponse(l.LinkId, l.Code, l.Channel, l.Template, l.SessionId, l.CreatedAt, l.Counts.Members, l.Counts.Bookings, l.Counts.Attended))]));
    }

    private static PublicPageResponse ToResponse(PublicPageView p) =>
        new(p.Enabled, p.OpenJoin, p.IntroProductId, p.SuggestWeeklyAt, p.Version.ToString(CultureInfo.InvariantCulture), p.InstagramHandle, p.ReferralRewardProductId);
}

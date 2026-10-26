using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Marketing;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.RateLimits;
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
        // A read, so off the link limit (S-A): the profile's card reads it on every visit ([O]'s finding on board #530).
        tenant.MapGet("/me/share-link", ReadShareLinkAsync).RequirePermission(Permissions.ScheduleView).WithName("readMyShareLink").Produces<MyShareLinkResponse>();
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
            new PublicPageChanges(
                request.Enabled,
                request.OpenJoin,
                SentGuid(request.IntroProductId, "introProductId"),
                SentText(request.SuggestWeeklyAt, "suggestWeeklyAt"),
                SentText(request.InstagramHandle, "instagramHandle"),
                SentGuid(request.ReferralRewardProductId, "referralRewardProductId"),
                request.ListedProducts?.Select(p => new ListedProduct(p.ProductId, p.NewcomersOnly, p.PublicUntil, p.Blurb)).ToList()),
            OrganizationEndpoints.ParseVersion(ifMatch),
            httpContext.RequestAborted);
        return Results.Ok(ToResponse(updated));
    }

    /// <summary>Left out: null (kept). Sent as null: a <see cref="Sent{T}"/> of null (cleared). Anything else: the id, or 400.</summary>
    private static Sent<Guid?>? SentGuid(JsonElement element, string field) => element.ValueKind switch
    {
        JsonValueKind.Undefined => null,
        JsonValueKind.Null => new Sent<Guid?>(null),
        JsonValueKind.String when element.TryGetGuid(out var id) => new Sent<Guid?>(id),
        _ => throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", "Use an id or null.", field)
    };

    private static Sent<string?>? SentText(JsonElement element, string field) => element.ValueKind switch
    {
        JsonValueKind.Undefined => null,
        JsonValueKind.Null => new Sent<string?>(null),
        JsonValueKind.String => new Sent<string?>(element.GetString()),
        _ => throw new DomainRuleViolationException(ViolationKind.Validation, $"{field}.invalid", "Use text or null.", field)
    };

    private static async Task<IResult> CreateLinkAsync(HttpContext httpContext, CreateMarketingLinkRequest request, IMarketingLinkService links, AppLinks apps, IClientRateLimiter limiter, ClientRateLimits limits)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        await limiter.HitAsync("marketing.links.user", tenant.UserAccountId.ToString(), limits.LinksPerUserPerHour, httpContext.RequestAborted);
        var link = await links.CreateAsync(tenant, new NewMarketingLink(request.Channel, request.Template, request.SessionId, request.Target?.Kind, request.Target?.Id), httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/marketing/links/{link.Id}", LinkResponse(link, apps));
    }

    /// <summary>The members-app address of a link by its target (SL-1): a class, an offer, the prices or the week.</summary>
    private static MarketingLinkResponse LinkResponse(MarketingLinkView link, AppLinks apps)
    {
        var studio = $"/s/{Uri.EscapeDataString(link.Slug)}";
        var path = link.TargetKind switch
        {
            "session" => $"{studio}/c/{link.TargetId}",
            "offer" => $"{studio}/o/{link.TargetId}",
            "prices" => $"{studio}/prices",
            _ => $"{studio}/"
        };
        return new MarketingLinkResponse(link.Id, link.Code, link.Channel, link.Template, link.SessionId, new Uri($"{apps.ClientApp}{path}?src={link.Code}"), link.CreatedAt,
            new MarketingTargetBody(link.TargetKind, link.TargetId), link.ShowName);
    }

    private static async Task<IResult> ShareLinkAsync(HttpContext httpContext, ShareLinkRequest request, IMemberMarketingService members, AppLinks apps, IClientRateLimiter limiter, ClientRateLimits limits)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        // One limit for every link a person makes, the studio's and their own (S-A, board #404).
        await limiter.HitAsync("marketing.links.user", tenant.UserAccountId.ToString(), limits.LinksPerUserPerHour, httpContext.RequestAborted);
        var link = await members.ShareLinkAsync(tenant, request.Channel, request.SessionId, httpContext.RequestAborted, request.ShowName);
        return Results.Ok(LinkResponse(link, apps));
    }

    private static async Task<IResult> ReadShareLinkAsync(HttpContext httpContext, string? channel, IMemberMarketingService members, AppLinks apps)
    {
        var mine = await members.ReadShareLinkAsync(TenantRouteFilter.Current(httpContext), channel, httpContext.RequestAborted);
        return Results.Ok(new MyShareLinkResponse(
            mine.Link is { } link ? LinkResponse(link, apps) : null,
            mine.RewardProductName is { } product ? new PublicLinkRewardResponse(product) : null));
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
            [.. report.ByLink.Select(l => new LinkSourceResponse(l.LinkId, l.Code, l.Channel, l.Template, l.SessionId, l.CreatedAt, l.Counts.Members, l.Counts.Bookings, l.Counts.Attended, new MarketingTargetBody(l.TargetKind, l.TargetId)))],
            [.. (report.ByTarget ?? []).Select(t => new TargetSourceResponse(t.Kind, t.Counts.Members, t.Counts.Bookings, t.Counts.Attended))]));
    }

    private static PublicPageResponse ToResponse(PublicPageView p) =>
        new(p.Enabled, p.OpenJoin, p.IntroProductId, p.SuggestWeeklyAt, p.Version.ToString(CultureInfo.InvariantCulture), p.InstagramHandle, p.ReferralRewardProductId,
            [.. p.Listed.Select(l => new ListedProductBody(l.ProductId, l.NewcomersOnly, l.PublicUntil, l.Blurb))]);
}

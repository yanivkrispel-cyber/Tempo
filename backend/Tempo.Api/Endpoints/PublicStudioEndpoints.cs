using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Tempo.Api.Middleware;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Marketing;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.RateLimits;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Marketing;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.Media;
using Tempo.Platform.Modules.Organizations.Domain;

namespace Tempo.Api.Endpoints;

/// <summary>
/// A studio's own installable app (docs/35 section 5, W-6, WL4): its web app manifest and its home-screen icons, for
/// anyone, no sign-in. `start_url`, `scope` and `id` are absolute on the members app's origin, because a manifest's
/// URLs resolve against the manifest's own URL (the API) and Chrome drops a scope on another origin than the page.
/// Icons are relative, so they resolve here. An icon URL carries the brand's version and is immutable for a year.
/// </summary>
public static class PublicStudioEndpoints
{
    /// <summary>The PNG names a manifest and iOS ask for (<see cref="StudioIcons.Sizes"/>).</summary>
    private static readonly HashSet<string> IconNames = [.. StudioIcons.Sizes.Select(s => s.Name)];

    private static readonly JsonSerializerOptions Json = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static IEndpointRouteBuilder MapPublicStudioEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var studio = endpoints.MapPublicStudioGroup();

        studio.MapGet(string.Empty, StudioAsync).AllowAnonymous().WithName("getPublicStudio");
        studio.MapGet("/sessions", SessionsAsync).AllowAnonymous().WithName("listPublicSessions");
        studio.MapGet("/sessions/{sessionId:guid}", SessionAsync).AllowAnonymous().WithName("getPublicSession");
        studio.MapGet("/manifest.webmanifest", ManifestAsync).AllowAnonymous().WithName("getStudioManifest");
        studio.MapGet("/icons/{size}", IconAsync).AllowAnonymous().WithName("getStudioIcon");
        studio.MapGet("/brand", BrandAsync).AllowAnonymous().WithName("getPublicBrand");
        studio.MapGet("/links/{code}", LinkAsync).AllowAnonymous().WithName("getPublicLink");
        studio.MapGet("/cover", StudioCoverAsync).AllowAnonymous().WithName("getPublicStudioCover");
        studio.MapGet("/sessions/{sessionId:guid}/cover", SessionCoverAsync).AllowAnonymous().WithName("getPublicSessionCover");
        studio.MapGet("/products", ProductsAsync).AllowAnonymous().WithName("listPublicProducts");
        studio.MapGet("/products/{productId:guid}", ProductAsync).AllowAnonymous().WithName("getPublicProduct");
        // Joining needs a customer token and a verified email (docs/37 section 4.3).
        studio.MapPost("/join", JoinAsync).RequireAuthorization().WithName("joinPublicStudio").Produces<PublicJoinResponse>();

        return endpoints;
    }

    /// <summary>docs/37 section 4.2: the page's studio. Picture URLs live an hour, so the cache stays below it.</summary>
    private static async Task<IResult> StudioAsync(HttpContext httpContext, IPublicStudioReads reads)
    {
        var page = await reads.GetStudioAsync(PublicStudioRouteFilter.Current(httpContext), httpContext.RequestAborted);
        var studio = page.Studio;
        httpContext.Response.Headers.CacheControl = "public, max-age=300";
        return Results.Ok(new PublicStudioResponse(
            studio.Slug,
            studio.DisplayName,
            studio.Brand.AppName,
            studio.Brand.AccentId,
            MediaLinks.UrlFor(studio.Id, studio.Brand.LogoMediaId, small: true),
            MediaLinks.UrlFor(studio.Id, page.CoverMediaId),
            page.TimeZone,
            page.HasIntroOffer ? new PublicIntroOfferResponse(page.IntroProductName!, page.IntroPriceAgorot) : null,
            page.OpenJoin));
    }

    private static async Task<IResult> SessionsAsync(HttpContext httpContext, string? from, string? to, IPublicStudioReads reads)
    {
        var studio = PublicStudioRouteFilter.Current(httpContext);
        var sessions = await reads.ListSessionsAsync(studio, Date(from, "from"), Date(to, "to"), httpContext.RequestAborted);
        httpContext.Response.Headers.CacheControl = "public, max-age=60";
        return Results.Ok(new PublicSessionListResponse([.. sessions.Select(s => ToResponse(studio.Id, s))]));
    }

    private static async Task<IResult> SessionAsync(HttpContext httpContext, Guid sessionId, IPublicStudioReads reads)
    {
        var studio = PublicStudioRouteFilter.Current(httpContext);
        var session = await reads.GetSessionAsync(studio, sessionId, httpContext.RequestAborted);
        httpContext.Response.Headers.CacheControl = "public, max-age=60";
        return Results.Ok(ToResponse(studio.Id, session));
    }

    private static PublicSessionResponse ToResponse(Guid studioId, PublicSessionView s) =>
        new(
            s.Id,
            s.StartsAt,
            s.Minutes,
            new PublicClassTypeResponse(s.ClassTypeName, s.ClassTypeCategory, s.ClassTypeColor),
            s.RoomName,
            MediaLinks.UrlFor(studioId, s.CoverMediaId),
            s.Instructor is { } i ? new PublicInstructorResponse(i.DisplayName, MediaLinks.UrlFor(studioId, i.PhotoMediaId, small: true), i.Headline, i.InstagramHandle) : null,
            s.Availability,
            s.SpotsLeft,
            s.WaitlistOpen,
            s.Event is { } e ? new PublicEventResponse(e.Title, e.Description, e.PriceAgorot, e.PassRequired) : null,
            s.Past,
            [.. (s.Alternatives ?? []).Select(a => new PublicSessionSummaryResponse(a.Id, a.StartsAt, a.Minutes, a.ClassName, a.InstructorName, a.Availability, a.SpotsLeft))]);

    /// <summary>SL-5: the prices page. Prices change rarely, so five minutes.</summary>
    private static async Task<IResult> ProductsAsync(HttpContext httpContext, IPublicStudioReads reads)
    {
        var products = await reads.ListProductsAsync(PublicStudioRouteFilter.Current(httpContext), httpContext.RequestAborted);
        httpContext.Response.Headers.CacheControl = "public, max-age=300";
        return Results.Ok(new PublicProductListResponse([.. products.Select(ProductResponse)]));
    }

    /// <summary>SL-4: one offer; `ended` instead of 404 once it ended, so the page can show the prices with a line.</summary>
    private static async Task<IResult> ProductAsync(HttpContext httpContext, Guid productId, IPublicStudioReads reads)
    {
        var product = await reads.GetProductAsync(PublicStudioRouteFilter.Current(httpContext), productId, httpContext.RequestAborted);
        httpContext.Response.Headers.CacheControl = "public, max-age=60";
        return Results.Ok(new PublicProductDetailResponse(product is null, product is null ? null : ProductResponse(product)));
    }

    private static PublicProductResponse ProductResponse(PublicProductView p) =>
        new(p.Id, p.Name, p.Kind, p.PriceAgorot, p.Entries, p.PricePerClassAgorot, p.ValidDays, p.NewcomersOnly, p.PublicUntil, p.Blurb);

    /// <summary>SL-1, SL-8, R-1: where a link leads, her first name on a member's own link she shows, the reward on a referral.</summary>
    private static async Task<IResult> LinkAsync(HttpContext httpContext, string code, IPublicStudioReads reads)
    {
        var link = await reads.GetLinkAsync(PublicStudioRouteFilter.Current(httpContext), code, httpContext.RequestAborted);
        httpContext.Response.Headers.CacheControl = "public, max-age=60";
        return Results.Ok(new PublicLinkTargetResponse(
            new MarketingTargetBody(link.TargetKind, link.TargetId),
            link.InviterFirstName,
            link.RewardProductName is { } product ? new PublicLinkRewardResponse(product) : null));
    }

    /// <summary>SL-9: the studio's cover for a link preview, else its icon; the picture's URL lives an hour.</summary>
    private static async Task<IResult> StudioCoverAsync(HttpContext httpContext, IPublicStudioReads reads)
    {
        var studio = PublicStudioRouteFilter.Current(httpContext);
        var page = await reads.GetStudioAsync(studio, httpContext.RequestAborted);
        return Cover(httpContext, studio, MediaLinks.UrlFor(studio.Id, page.CoverMediaId));
    }

    /// <summary>SL-9: the class's cover for a link preview, else the studio's, else its icon.</summary>
    private static async Task<IResult> SessionCoverAsync(HttpContext httpContext, Guid sessionId, IPublicStudioReads reads)
    {
        var studio = PublicStudioRouteFilter.Current(httpContext);
        var session = await reads.GetSessionAsync(studio, sessionId, httpContext.RequestAborted);
        var url = MediaLinks.UrlFor(studio.Id, session.CoverMediaId);
        if (url is null)
        {
            var page = await reads.GetStudioAsync(studio, httpContext.RequestAborted);
            url = MediaLinks.UrlFor(studio.Id, page.CoverMediaId);
        }

        return Cover(httpContext, studio, url);
    }

    private static IResult Cover(HttpContext httpContext, PublicStudio studio, Uri? picture)
    {
        httpContext.Response.Headers.CacheControl = "public, max-age=300";
        return Results.Redirect(picture?.ToString() ?? $"/api/v1/public/studios/{Uri.EscapeDataString(studio.Slug)}/icons/512?v={studio.Brand.Version}");
    }

    /// <summary>
    /// docs/35 W-4, W-10: what the studio's own app and its sign-in wear, for any active studio, public page on or off.
    /// The manifest already says the name and the accent; the logo is the only addition.
    /// </summary>
    private static IResult BrandAsync(HttpContext httpContext)
    {
        var studio = PublicStudioRouteFilter.Current(httpContext);
        httpContext.Response.Headers.CacheControl = "public, max-age=300";
        return Results.Ok(new PublicBrandResponse(studio.Slug, studio.Brand.AppName, studio.Brand.AccentId, MediaLinks.UrlFor(studio.Id, studio.Brand.LogoMediaId, small: true)));
    }

    private static DateOnly? Date(string? value, string field)
    {
        if (value is null)
        {
            return null;
        }

        return DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : throw new DomainRuleViolationException(ViolationKind.Validation, "range.invalid", "Dates are yyyy-mm-dd.", field);
    }

    private static async Task<IResult> JoinAsync(
        HttpContext httpContext,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] PublicJoinRequest? request,
        IAccountDirectory accounts,
        IPublicJoinService joins,
        IClientRateLimiter limiter,
        ClientRateLimits limits)
    {
        var (caller, problem) = await CallerAccount.ResolveAsync(httpContext, accounts);
        if (caller is null)
        {
            return problem!;
        }

        // S-A (board #404): per source address and per account, counted before the join so refused tries count too.
        // The address is API Gateway's source IP, or CloudFront's viewer address on the edge path (ClientAddress).
        if (ClientAddress.Of(httpContext) is { } address)
        {
            await limiter.HitAsync("public.join.ip", address, limits.JoinPerIpPerHour, httpContext.RequestAborted);
        }

        await limiter.HitAsync("public.join.user", caller.UserAccountId.ToString(), limits.JoinPerUserPerHour, httpContext.RequestAborted);

        var studio = PublicStudioRouteFilter.Current(httpContext);
        var correlationId = httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier;
        var joined = await joins.JoinAsync(caller, studio, new PublicJoinRequestView(request?.Src, request?.ProductId, request?.SessionId), correlationId, httpContext.RequestAborted);
        return Results.Ok(new PublicJoinResponse(
            studio.Id,
            joined.Membership.MembershipId,
            joined.Created,
            joined.IntroPass is { } p ? new PublicIntroPassResponse(p.PassId, p.ProductName, p.ToPayAtStudio) : null,
            joined.Booking is { } b ? new PublicJoinBookingResponse(b.BookingId, b.SessionId, b.Status) : null,
            joined.Next));
    }

    private static IResult ManifestAsync(HttpContext httpContext, AppLinks links)
    {
        var studio = PublicStudioRouteFilter.Current(httpContext);
        var home = $"{links.ClientApp}/s/{Uri.EscapeDataString(studio.Slug)}/";
        var icon = (string name) => $"icons/{name}?v={studio.Brand.Version}";
        var manifest = new
        {
            id = home,
            name = studio.DisplayName,
            short_name = studio.Brand.AppName,
            lang = "he",
            dir = "rtl",
            start_url = home,
            scope = home,
            display = "standalone",
            orientation = "portrait",
            background_color = Brand.PaperHex,
            theme_color = Brand.Accents[studio.Brand.AccentId],
            icons = new object[]
            {
                new { src = icon("192"), sizes = "192x192", type = "image/png", purpose = "any" },
                new { src = icon("512"), sizes = "512x512", type = "image/png", purpose = "any" },
                new { src = icon("512-maskable"), sizes = "512x512", type = "image/png", purpose = "maskable" }
            }
        };

        // The manifest changes with the brand, so phones may keep it only briefly.
        httpContext.Response.Headers.CacheControl = "public, max-age=300";
        return Results.Text(JsonSerializer.Serialize(manifest, Json), "application/manifest+json");
    }

    private static async Task<IResult> IconAsync(HttpContext httpContext, string size, string? v, IMediaStore store)
    {
        if (!IconNames.Contains(size))
        {
            return Results.NotFound();
        }

        var studio = PublicStudioRouteFilter.Current(httpContext);
        byte[]? png = null;
        if (studio.Brand.IconMediaId is { } iconId && store.Available)
        {
            png = await store.ReadAsync(MediaKeys.Icon(studio.Id, iconId, size), MediaService.MaxUploadBytes, httpContext.RequestAborted);
        }

        // No icon (W-2): the studio's initials on its accent. An icon whose PNG can't be read now gets them too.
        var missing = png is null && studio.Brand.IconMediaId is not null;
        png ??= StudioIcons.RenderInitials(studio.DisplayName, Brand.Accents[studio.Brand.AccentId], size);
        // A year of cache only for the URL that names the brand's current version (#387 review): a request without
        // `v`, with an old one, or for a PNG that can't be read now is kept for a minute, so a rebrand shows.
        var current = !missing && v == studio.Brand.Version.ToString(System.Globalization.CultureInfo.InvariantCulture);
        httpContext.Response.Headers.CacheControl = current ? "public, max-age=31536000, immutable" : "public, max-age=60";
        return Results.Bytes(png, "image/png");
    }
}

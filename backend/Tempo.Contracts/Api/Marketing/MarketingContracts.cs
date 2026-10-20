using System.Text.Json;

namespace Tempo.Contracts.Api.Marketing;

/// <summary>`PublicPage` (docs/37 section 4.4): the studio's public page settings. Send `Version` back in If-Match.</summary>
public sealed record PublicPageResponse(
    bool Enabled,
    bool OpenJoin,
    Guid? IntroProductId,
    string? SuggestWeeklyAt,
    string Version,
    string? InstagramHandle,
    Guid? ReferralRewardProductId,
    IReadOnlyList<ListedProductBody> ListedProducts);

/// <summary>
/// `PublicPageInput`: `enabled` and `openJoin` are required. Every other field is kept when it is left out and cleared
/// when it is sent as null, so each is a raw element: `Undefined` when absent, `Null` when cleared (#396 review).
/// </summary>
public sealed record UpdatePublicPageRequest(
    bool? Enabled,
    bool? OpenJoin,
    JsonElement IntroProductId = default,
    JsonElement SuggestWeeklyAt = default,
    JsonElement InstagramHandle = default,
    JsonElement ReferralRewardProductId = default,
    IReadOnlyList<ListedProductBody>? ListedProducts = null);

/// <summary>`ListedProduct` (SL-4, SL-5): the array order is the public order.</summary>
public sealed record ListedProductBody(Guid ProductId, bool NewcomersOnly, DateOnly? PublicUntil, string? Blurb);

/// <summary>`PublicStudio` (docs/37 section 4.2): what anyone sees of a studio whose public page is on.</summary>
public sealed record PublicStudioResponse(
    string Slug,
    string Name,
    string AppName,
    string AccentId,
    Uri? LogoUrl,
    Uri? CoverUrl,
    string TimeZone,
    PublicIntroOfferResponse? IntroOffer,
    bool OpenJoin);

public sealed record PublicIntroOfferResponse(string Name, int? PriceAgorot);

/// <summary>`PublicSession`: availability is a bucket (M-10), never a count of people.</summary>
public sealed record PublicSessionResponse(
    Guid Id,
    DateTimeOffset StartsAt,
    int Minutes,
    PublicClassTypeResponse ClassType,
    string? RoomName,
    Uri? CoverUrl,
    PublicInstructorResponse? Instructor,
    string Availability,
    int? SpotsLeft,
    bool WaitlistOpen,
    PublicEventResponse? Event,
    bool Past,
    IReadOnlyList<PublicSessionSummaryResponse> Alternatives);

/// <summary>`PublicSessionSummary` (SL-3): an upcoming class with room, offered instead of a full, cancelled or past one.</summary>
public sealed record PublicSessionSummaryResponse(Guid Id, DateTimeOffset StartsAt, int Minutes, string ClassName, string? InstructorName, string Availability, int? SpotsLeft);

/// <summary>`PublicProduct` (SL-4, SL-5): shown only; payment is at the studio.</summary>
public sealed record PublicProductResponse(
    Guid Id,
    string Name,
    string Kind,
    int? PriceAgorot,
    int? Entries,
    int? PricePerClassAgorot,
    int ValidDays,
    bool NewcomersOnly,
    DateOnly? PublicUntil,
    string? Blurb);

public sealed record PublicProductListResponse(IReadOnlyList<PublicProductResponse> Items);

/// <summary>`PublicProductDetail`: `Ended` with no product when the offer ended or was archived (SL-4).</summary>
public sealed record PublicProductDetailResponse(bool Ended, PublicProductResponse? Product);

/// <summary>An event's public face: shown in its own layout on the public page (docs/37 section 8.4).</summary>
public sealed record PublicEventResponse(string Title, string? Description, int? PriceAgorot, bool PassRequired);

public sealed record PublicClassTypeResponse(string Name, string Category, string Color);

public sealed record PublicInstructorResponse(string DisplayName, Uri? PhotoUrl, string? Headline, string? InstagramHandle);

public sealed record PublicSessionListResponse(IReadOnlyList<PublicSessionResponse> Items);

/// <summary>`PublicJoinRequest`: the first-touch source code the members app kept, if any.</summary>
public sealed record PublicJoinRequest(string? Src, Guid? ProductId = null, Guid? SessionId = null);

/// <summary>`PublicJoinResponse`: the membership, whether it is new, and the intro pass granted now, if any.</summary>
public sealed record PublicJoinResponse(Guid OrganizationId, Guid MembershipId, bool Created, PublicIntroPassResponse? IntroPass, PublicJoinBookingResponse? Booking = null, string? Next = null);

/// <summary>The place the offer join took (SK3).</summary>
public sealed record PublicJoinBookingResponse(Guid BookingId, Guid SessionId, string Status);

public sealed record PublicIntroPassResponse(Guid PassId, string ProductName, bool ToPayAtStudio);

/// <summary>`MarketingLinkInput`: where the link goes, which template made it, and the class it points at.</summary>
public sealed record CreateMarketingLinkRequest(string? Channel, string? Template, Guid? SessionId, MarketingTargetBody? Target = null);

/// <summary>`MarketingTarget` (SL-1): `session`, `schedule`, `offer` or `prices`, with the session's or product's id.</summary>
public sealed record MarketingTargetBody(string Kind, Guid? Id);

/// <summary>`PublicLinkTarget` (SL-1, SL-8).</summary>
public sealed record PublicLinkTargetResponse(MarketingTargetBody Target, string? InviterFirstName);

/// <summary>`MarketingLink`: `Url` is the members-app address with `?src=`.</summary>
public sealed record MarketingLinkResponse(Guid Id, string Code, string Channel, string? Template, Guid? SessionId, Uri Url, DateTimeOffset CreatedAt, MarketingTargetBody Target, bool? ShowName);

/// <summary>`SourceReport` (docs/37 section 6): per channel and per link, new members, bookings and attended bookings.</summary>
public sealed record SourceReportResponse(int Days, IReadOnlyList<ChannelSourceResponse> ByChannel, IReadOnlyList<LinkSourceResponse> ByLink, IReadOnlyList<TargetSourceResponse> ByTarget);

/// <summary>The report's counts per kind of target (SL-1).</summary>
public sealed record TargetSourceResponse(string Kind, int Members, int Bookings, int Attended);

public sealed record ChannelSourceResponse(string Channel, int Members, int Bookings, int Attended);

public sealed record LinkSourceResponse(Guid LinkId, string Code, string Channel, string? Template, Guid? SessionId, DateTimeOffset CreatedAt, int Members, int Bookings, int Attended, MarketingTargetBody Target);

/// <summary>`ShareLinkInput`: a member's own link for a card or a referral.</summary>
public sealed record ShareLinkRequest(string? Channel, Guid? SessionId, bool? ShowName = null);

/// <summary>`MyMilestones` (docs/37 section 8.2).</summary>
public sealed record MyMilestonesResponse(
    int Attended,
    IReadOnlyList<int> Reached,
    int? Next,
    double HoursOnTheMat,
    int LongestWeekStreak,
    string? UsualTime,
    string? TopInstructor);

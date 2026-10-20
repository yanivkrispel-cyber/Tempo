namespace Tempo.Contracts.Api.Marketing;

/// <summary>`PublicPage` (docs/37 section 4.4): the studio's public page settings. Send `Version` back in If-Match.</summary>
public sealed record PublicPageResponse(
    bool Enabled,
    bool OpenJoin,
    Guid? IntroProductId,
    string? SuggestWeeklyAt,
    string Version,
    string? InstagramHandle,
    Guid? ReferralRewardProductId);

/// <summary>`PublicPageInput`: `enabled` and `openJoin` are required; a null intro product or weekly time clears it.</summary>
public sealed record UpdatePublicPageRequest(
    bool? Enabled,
    bool? OpenJoin,
    Guid? IntroProductId,
    string? SuggestWeeklyAt,
    string? InstagramHandle = null,
    Guid? ReferralRewardProductId = null);

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
    PublicEventResponse? Event);

/// <summary>An event's public face: shown in its own layout on the public page (docs/37 section 8.4).</summary>
public sealed record PublicEventResponse(string Title, string? Description, int? PriceAgorot, bool PassRequired);

public sealed record PublicClassTypeResponse(string Name, string Category, string Color);

public sealed record PublicInstructorResponse(string DisplayName, Uri? PhotoUrl, string? Headline, string? InstagramHandle);

public sealed record PublicSessionListResponse(IReadOnlyList<PublicSessionResponse> Items);

/// <summary>`PublicJoinRequest`: the first-touch source code the members app kept, if any.</summary>
public sealed record PublicJoinRequest(string? Src);

/// <summary>`PublicJoinResponse`: the membership, whether it is new, and the intro pass granted now, if any.</summary>
public sealed record PublicJoinResponse(Guid OrganizationId, Guid MembershipId, bool Created, PublicIntroPassResponse? IntroPass);

public sealed record PublicIntroPassResponse(Guid PassId, string ProductName, bool ToPayAtStudio);

/// <summary>`MarketingLinkInput`: where the link goes, which template made it, and the class it points at.</summary>
public sealed record CreateMarketingLinkRequest(string? Channel, string? Template, Guid? SessionId);

/// <summary>`MarketingLink`: `Url` is the members-app address with `?src=`.</summary>
public sealed record MarketingLinkResponse(Guid Id, string Code, string Channel, string? Template, Guid? SessionId, Uri Url, DateTimeOffset CreatedAt);

/// <summary>`SourceReport` (docs/37 section 6): per channel and per link, new members, bookings and attended bookings.</summary>
public sealed record SourceReportResponse(int Days, IReadOnlyList<ChannelSourceResponse> ByChannel, IReadOnlyList<LinkSourceResponse> ByLink);

public sealed record ChannelSourceResponse(string Channel, int Members, int Bookings, int Attended);

public sealed record LinkSourceResponse(Guid LinkId, string Code, string Channel, string? Template, Guid? SessionId, DateTimeOffset CreatedAt, int Members, int Bookings, int Attended);

/// <summary>`ShareLinkInput`: a member's own link for a card or a referral.</summary>
public sealed record ShareLinkRequest(string? Channel, Guid? SessionId);

/// <summary>`MyMilestones` (docs/37 section 8.2).</summary>
public sealed record MyMilestonesResponse(
    int Attended,
    IReadOnlyList<int> Reached,
    int? Next,
    double HoursOnTheMat,
    int LongestWeekStreak,
    string? UsualTime,
    string? TopInstructor);

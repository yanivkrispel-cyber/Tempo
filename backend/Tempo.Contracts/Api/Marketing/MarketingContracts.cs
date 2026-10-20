namespace Tempo.Contracts.Api.Marketing;

/// <summary>`PublicPage` (docs/37 section 4.4): the studio's public page settings. Send `Version` back in If-Match.</summary>
public sealed record PublicPageResponse(bool Enabled, bool OpenJoin, Guid? IntroProductId, string? SuggestWeeklyAt, string Version);

/// <summary>`PublicPageInput`: `enabled` and `openJoin` are required; a null intro product or weekly time clears it.</summary>
public sealed record UpdatePublicPageRequest(bool? Enabled, bool? OpenJoin, Guid? IntroProductId, string? SuggestWeeklyAt);

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
    bool WaitlistOpen);

public sealed record PublicClassTypeResponse(string Name, string Category, string Color);

public sealed record PublicInstructorResponse(string DisplayName, Uri? PhotoUrl, string? Headline, string? InstagramHandle);

public sealed record PublicSessionListResponse(IReadOnlyList<PublicSessionResponse> Items);

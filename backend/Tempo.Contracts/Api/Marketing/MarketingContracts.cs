namespace Tempo.Contracts.Api.Marketing;

/// <summary>`PublicPage` (docs/37 section 4.4): the studio's public page settings. Send `Version` back in If-Match.</summary>
public sealed record PublicPageResponse(bool Enabled, bool OpenJoin, Guid? IntroProductId, string? SuggestWeeklyAt, string Version);

/// <summary>`PublicPageInput`: `enabled` and `openJoin` are required; a null intro product or weekly time clears it.</summary>
public sealed record UpdatePublicPageRequest(bool? Enabled, bool? OpenJoin, Guid? IntroProductId, string? SuggestWeeklyAt);

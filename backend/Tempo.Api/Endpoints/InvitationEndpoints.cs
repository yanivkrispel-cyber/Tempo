using Tempo.Api.Middleware;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Organizations;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Where the apps live, for the links the API hands out: ADMIN_APP_URL and
/// CLIENT_APP_URL (origins, no trailing slash). Locally they default to the
/// Vite ports of admin-web and client-web.
/// </summary>
public sealed class AppLinks(IConfiguration configuration)
{
    public string AdminApp { get; } = (configuration["ADMIN_APP_URL"] ?? "http://localhost:5173").TrimEnd('/');

    public string ClientApp { get; } = (configuration["CLIENT_APP_URL"] ?? "http://localhost:5174").TrimEnd('/');

    /// <summary>
    /// Clients accept in the client app; admins and staff in the admin app.
    /// The token sits in the fragment, which browsers never send to a server,
    /// so it stays out of every access log (docs/26 section 5.3).
    /// </summary>
    /// <remarks>
    /// With the studio's slug, a client's link opens the studio's own app, `/s/<slug>/invite#` (docs/35 W-4); the plain
    /// `/invite#` keeps working for links already sent.
    /// </remarks>
    public string Invitation(MembershipRole role, string token, string? slug = null) =>
        role == MembershipRole.Client ? $"{ClientApp}{Studio(slug)}/invite#{token}" : $"{AdminApp}/invite#{token}";

    public string Join(string code, string? slug = null) => $"{ClientApp}{Studio(slug)}/join#{code}";

    private static string Studio(string? slug) => string.IsNullOrEmpty(slug) ? string.Empty : $"/s/{Uri.EscapeDataString(slug)}";
}

/// <summary>
/// Invitations and the join link (docs/26 sections 5 and 8). Tokens and codes
/// travel in request bodies only, never in a URL the API logs (section 5.3).
/// </summary>
public static class InvitationEndpoints
{
    public static IEndpointRouteBuilder MapInvitationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var account = endpoints.MapAccountGroup();
        account.MapPost("/invitations/preview", PreviewInvitationAsync).WithName("previewInvitation").Produces<InvitationPreviewResponse>();
        account.MapPost("/invitations/accept", AcceptInvitationAsync).WithName("acceptInvitation");
        account.MapPost("/join/preview", PreviewJoinAsync).WithName("previewJoin").Produces<JoinPreviewResponse>();
        account.MapPost("/join", JoinAsync).WithName("joinOrganization");

        var tenant = endpoints.MapTenantGroup();
        tenant.MapGet("/invitations", ListAsync).RequirePermission(Permissions.MembersInviteStaff).WithName("listInvitations").Produces<InvitationPageResponse>();
        tenant.MapPost("/invitations", CreateAsync).RequirePermission(Permissions.MembersInviteStaff).WithName("createInvitation").Produces<CreatedInvitationResponse>(StatusCodes.Status201Created);
        tenant.MapDelete("/invitations/{invitationId:guid}", RevokeAsync).RequirePermission(Permissions.MembersInviteStaff).WithName("revokeInvitation").WithMetadata(new AllowWhenSubscriptionRestrictedAttribute()).Produces(StatusCodes.Status204NoContent);
        tenant.MapPut("/join-link", RotateJoinLinkAsync).RequirePermission(Permissions.MembersInviteStaff).WithName("rotateJoinLink").Produces<JoinLinkResponse>();
        tenant.MapDelete("/join-link", DisableJoinLinkAsync).RequirePermission(Permissions.MembersInviteStaff).WithName("disableJoinLink").WithMetadata(new AllowWhenSubscriptionRestrictedAttribute()).Produces(StatusCodes.Status204NoContent);

        return endpoints;
    }

    private static async Task<IResult> PreviewInvitationAsync(HttpContext httpContext, TokenRequest request, IAccountDirectory accounts, IInvitationService invitations)
    {
        var (caller, problem) = await CallerAccount.ResolveAsync(httpContext, accounts);
        if (caller is null)
        {
            return problem!;
        }

        var preview = await invitations.PreviewAsync(caller, request.Token ?? string.Empty, httpContext.RequestAborted);
        return Results.Ok(new InvitationPreviewResponse(
            new OrganizationRefResponse(preview.OrganizationId, preview.OrganizationDisplayName),
            StoredValue.Of(preview.Role),
            preview.InvitedByDisplayName,
            preview.ExpiresAt));
    }

    private static async Task<IResult> AcceptInvitationAsync(HttpContext httpContext, TokenRequest request, IAccountDirectory accounts, IInvitationService invitations)
    {
        var (caller, problem) = await CallerAccount.ResolveAsync(httpContext, accounts);
        if (caller is null)
        {
            return problem!;
        }

        var membership = await invitations.AcceptAsync(caller, request.Token ?? string.Empty, CorrelationId(httpContext), httpContext.RequestAborted);
        return Results.Ok(AccountEndpoints.ToResponse(membership));
    }

    private static async Task<IResult> PreviewJoinAsync(HttpContext httpContext, JoinCodeRequest request, IAccountDirectory accounts, IJoinLinkService joinLinks)
    {
        var (caller, problem) = await CallerAccount.ResolveAsync(httpContext, accounts);
        if (caller is null)
        {
            return problem!;
        }

        var preview = await joinLinks.PreviewAsync(caller, request.Code ?? string.Empty, httpContext.RequestAborted);
        return Results.Ok(new JoinPreviewResponse(new OrganizationRefResponse(preview.OrganizationId, preview.DisplayName)));
    }

    private static async Task<IResult> JoinAsync(HttpContext httpContext, JoinCodeRequest request, IAccountDirectory accounts, IJoinLinkService joinLinks)
    {
        var (caller, problem) = await CallerAccount.ResolveAsync(httpContext, accounts);
        if (caller is null)
        {
            return problem!;
        }

        var membership = await joinLinks.JoinAsync(caller, request.Code ?? string.Empty, CorrelationId(httpContext), httpContext.RequestAborted);
        return Results.Ok(AccountEndpoints.ToResponse(membership));
    }

    private static async Task<IResult> ListAsync(HttpContext httpContext, string? status, Guid? before, int? limit, IInvitationService invitations)
    {
        var page = await invitations.ListAsync(
            TenantRouteFilter.Current(httpContext),
            new InvitationQuery(OrganizationEndpoints.ParseEnum<InvitationStatus>(status, "status"), before, limit ?? 50),
            httpContext.RequestAborted);
        return Results.Ok(new InvitationPageResponse([.. page.Items.Select(ToResponse)], page.NextBefore));
    }

    private static async Task<IResult> CreateAsync(HttpContext httpContext, CreateInvitationRequest request, IInvitationService invitations, IOrganizationService organizations, AppLinks links)
    {
        var role = OrganizationEndpoints.ParseEnum<MembershipRole>(request.Role, "role")
            ?? throw new DomainRuleViolationException(ViolationKind.Validation, "role.invalid", "Choose admin, staff or client.", "role");

        var created = await invitations.CreateAsync(TenantRouteFilter.Current(httpContext), request.Email ?? string.Empty, role, httpContext.RequestAborted);
        var i = created.Invitation;
        var slug = i.Role == MembershipRole.Client ? await organizations.SlugAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted) : null;
        return Results.Created(
            $"/api/v1/organizations/{TenantRouteFilter.Current(httpContext).OrganizationId}/invitations/{i.Id}",
            new CreatedInvitationResponse(
                i.Id,
                i.Email,
                StoredValue.Of(i.Role),
                StoredValue.Of(i.Status),
                i.ExpiresAt,
                i.CreatedAt,
                new InvitedByResponse(i.InvitedByMembershipId, i.InvitedByDisplayName),
                links.Invitation(i.Role, created.Token, slug)));
    }

    private static async Task<IResult> RevokeAsync(HttpContext httpContext, Guid invitationId, IInvitationService invitations)
    {
        await invitations.RevokeAsync(TenantRouteFilter.Current(httpContext), invitationId, httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static async Task<IResult> RotateJoinLinkAsync(HttpContext httpContext, IJoinLinkService joinLinks, IOrganizationService organizations, AppLinks links, TimeProvider clock)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var code = await joinLinks.RotateAsync(tenant, httpContext.RequestAborted);
        return Results.Ok(new JoinLinkResponse(links.Join(code, await organizations.SlugAsync(tenant, httpContext.RequestAborted)), clock.GetUtcNow()));
    }

    private static async Task<IResult> DisableJoinLinkAsync(HttpContext httpContext, IJoinLinkService joinLinks)
    {
        await joinLinks.DisableAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted);
        return Results.NoContent();
    }

    private static InvitationResponse ToResponse(InvitationView i) =>
        new(i.Id, i.Email, StoredValue.Of(i.Role), StoredValue.Of(i.Status), i.ExpiresAt, i.CreatedAt, new InvitedByResponse(i.InvitedByMembershipId, i.InvitedByDisplayName));

    private static string CorrelationId(HttpContext httpContext) =>
        httpContext.Items[CorrelationIdMiddleware.ItemKey] as string ?? httpContext.TraceIdentifier;
}

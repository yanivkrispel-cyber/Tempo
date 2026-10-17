using System.Globalization;
using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Health;
using Tempo.Contracts.Api.People;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Duplicate candidates and merge, export and erasure (docs/27 sections 4.6,
/// 4.7 and 6). Export and erase need a sign-in within ten minutes.
/// </summary>
public static partial class PersonLifecycleEndpoints
{
    public static IEndpointRouteBuilder MapPersonLifecycleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/duplicate-candidates", ListAsync).RequirePermission(Permissions.PeopleMerge).WithName("listDuplicateCandidates").Produces<DuplicateCandidatePageResponse>();
        tenant.MapPost("/duplicate-candidates/{candidateId:guid}/resolve", ResolveAsync).RequirePermission(Permissions.PeopleMerge).WithName("resolveDuplicateCandidate").Produces<DuplicateCandidateResponse>();
        tenant.MapPost("/people/{personId:guid}/export", ExportAsync).RequirePermission(Permissions.PeopleExport).WithName("exportPerson").WithMetadata(new AllowWhenSubscriptionRestrictedAttribute()).Produces<PersonExportResponse>();
        tenant.MapPost("/people/{personId:guid}/erase", EraseAsync).RequirePermission(Permissions.PeopleErase).WithName("erasePerson").WithMetadata(new AllowWhenSubscriptionRestrictedAttribute()).Produces<PersonDetailResponse>();

        return endpoints;
    }

    private static async Task<IResult> ListAsync(HttpContext httpContext, string? status, Guid? before, int? limit, IPersonLifecycleService lifecycle)
    {
        var page = await lifecycle.ListCandidatesAsync(TenantRouteFilter.Current(httpContext), status, before, limit ?? 50, httpContext.RequestAborted);
        return Results.Ok(new DuplicateCandidatePageResponse([.. page.Items.Select(ToResponse)], page.NextBefore));
    }

    private static async Task<IResult> ResolveAsync(HttpContext httpContext, Guid candidateId, ResolveDuplicateRequest request, IPersonLifecycleService lifecycle)
    {
        var resolved = await lifecycle.ResolveAsync(TenantRouteFilter.Current(httpContext), candidateId, request.Resolution, request.SurvivorPersonId, httpContext.RequestAborted);
        return Results.Ok(ToResponse(resolved));
    }

    private static async Task<IResult> ExportAsync(HttpContext httpContext, Guid personId, IPersonLifecycleService lifecycle, TimeProvider clock, ILoggerFactory loggers)
    {
        StepUp.Require(httpContext, clock);
        var export = await lifecycle.ExportAsync(TenantRouteFilter.Current(httpContext), personId, httpContext.RequestAborted);
        if (export.HealthAnswersWithheldReason == PersonExportView.HealthKeyUnavailable)
        {
            LogHealthKeyUnavailable(loggers.CreateLogger(typeof(PersonLifecycleEndpoints)));
        }

        return Results.Ok(new PersonExportResponse(
            export.ExportedAt,
            new ExportOrganizationResponse(export.OrganizationId, export.OrganizationName),
            PeopleEndpoints.ToResponse(export.Person),
            [.. export.ConsentHistory.Select(PeopleEndpoints.ToResponse)],
            [.. export.Bookings.Select(b => new ExportBookingResponse(b.Id, b.SessionId, b.ClassName, b.StartsAt, b.Status, b.LateCancel, b.CancelReason, b.CreatedAt))],
            [.. export.Passes.Select(p => new ExportPassResponse(p.Id, p.ProductName, p.Kind, p.StartsOn, p.EndsOn, p.Entries, p.EntriesUsed, p.Status, p.CreatedAt))],
            [.. export.HealthDeclarations.Select(h => new ExportHealthDeclarationResponse(
                h.DeclarationId,
                h.FormVersion,
                h.Status,
                h.SignerRole,
                h.SignedAt,
                h.ExpiresAt,
                h.SupersededAt,
                h.MedicalApprovalOn,
                h.Answers is null ? null : [.. h.Answers.Select(a => new HealthAnswerResponse(a.QuestionId, a.Answer))],
                h.SignedName,
                h.GuardianName))],
            export.HealthAnswersWithheld,
            export.HealthAnswersWithheldReason,
            [.. (export.Buddies ?? []).Select(b => new BuddyResponse(b.PersonId, b.DisplayName, b.Since))]));
    }

    private static async Task<IResult> EraseAsync(HttpContext httpContext, Guid personId, ErasePersonRequest request, IPersonLifecycleService lifecycle, TimeProvider clock)
    {
        StepUp.Require(httpContext, clock);
        var erased = await lifecycle.EraseAsync(TenantRouteFilter.Current(httpContext), personId, request.Reason ?? string.Empty, httpContext.RequestAborted);
        return Results.Ok(PeopleEndpoints.ToResponse(erased));
    }

    private static DuplicateCandidateResponse ToResponse(DuplicateCandidateView d) =>
        new(d.Id, d.Reason, d.Status, PeopleEndpoints.ToResponse(d.PersonA), PeopleEndpoints.ToResponse(d.PersonB), d.CreatedAt, d.Version.ToString(CultureInfo.InvariantCulture));

    // A-5: no person, studio or declaration content, only that the key was not readable.
    [LoggerMessage(Level = LogLevel.Warning, Message = "Export sent with health answers withheld: the health data key could not be read")]
    private static partial void LogHealthKeyUnavailable(ILogger logger);
}

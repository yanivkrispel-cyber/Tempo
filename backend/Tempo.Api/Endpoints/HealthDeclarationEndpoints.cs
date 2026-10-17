using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Health;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.People.Domain;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The health declaration (docs/31 section 9). The member's own routes are self routes (`schedule.view`, which every
/// role holds); a person's status needs `people.view`; answers and medical approval need `health.view`. Request
/// bodies are never logged (RequestLogging logs method, route and status only), so answers and names reach no log.
/// </summary>
public static class HealthDeclarationEndpoints
{
    public static IEndpointRouteBuilder MapHealthDeclarationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/me/health-declaration", GetMineAsync).RequirePermission(Permissions.ScheduleView).WithName("getMyHealthDeclaration").Produces<MyHealthDeclarationResponse>();
        tenant.MapPost("/me/health-declaration", SignAsync).RequirePermission(Permissions.ScheduleView).WithName("signMyHealthDeclaration").Produces<MyHealthDeclarationResponse>(StatusCodes.Status201Created);
        tenant.MapGet("/people/{personId:guid}/health-declaration", GetStatusAsync).RequirePermission(Permissions.PeopleView).WithName("getPersonHealthDeclaration").Produces<HealthDeclarationStatusResponse>();
        tenant.MapGet("/people/{personId:guid}/health-declaration/answers", GetAnswersAsync).RequirePermission(Permissions.HealthView).WithName("getPersonHealthDeclarationAnswers").Produces<HealthDeclarationAnswersResponse>();
        tenant.MapPost("/people/{personId:guid}/health-declaration/medical-approval", RecordApprovalAsync).RequirePermission(Permissions.HealthView).WithName("recordMedicalApproval").Produces<HealthDeclarationStatusResponse>();

        return endpoints;
    }

    private static async Task<IResult> GetMineAsync(HttpContext httpContext, IHealthDeclarationService health) =>
        Results.Ok(ToResponse(await health.GetMineAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)));

    private static async Task<IResult> SignAsync(HttpContext httpContext, SignHealthDeclarationRequest request, IHealthDeclarationService health)
    {
        var answers = (request.Answers ?? []).Select(a => a.QuestionId is { } id && a.Answer is { } answer
                ? new HealthAnswerView(id, answer)
                : throw new DomainRuleViolationException(ViolationKind.Validation, "health.answers_incomplete", "Answer every question yes or no.", "answers"))
            .ToList();
        var declaration = new NewHealthDeclaration(
            request.FormVersion ?? throw new DomainRuleViolationException(ViolationKind.Validation, "formVersion.required", "Say which form version was signed.", "formVersion"),
            answers,
            request.SignedName,
            request.SignerRole,
            request.GuardianName,
            request.Confirmed == true);
        var tenant = TenantRouteFilter.Current(httpContext);
        var signed = await health.SignMineAsync(tenant, declaration, httpContext.RequestAborted);
        return Results.Created($"/api/v1/organizations/{tenant.OrganizationId}/me/health-declaration", ToResponse(signed));
    }

    private static async Task<IResult> GetStatusAsync(HttpContext httpContext, Guid personId, IHealthDeclarationService health) =>
        Results.Ok(ToResponse(await health.GetStatusAsync(TenantRouteFilter.Current(httpContext), personId, httpContext.RequestAborted)));

    private static async Task<IResult> GetAnswersAsync(HttpContext httpContext, Guid personId, IHealthDeclarationService health)
    {
        var view = await health.GetAnswersAsync(TenantRouteFilter.Current(httpContext), personId, httpContext.RequestAborted);
        httpContext.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new HealthDeclarationAnswersResponse(
            view.DeclarationId,
            view.Status,
            ToResponse(view.Form),
            [.. view.Answers.Select(a => new HealthAnswerResponse(a.QuestionId, a.Answer))],
            view.SignedName,
            view.SignerRole,
            view.GuardianName,
            view.SignedAt,
            view.ExpiresAt,
            view.MedicalApprovalOn));
    }

    private static async Task<IResult> RecordApprovalAsync(HttpContext httpContext, Guid personId, MedicalApprovalRequest request, IHealthDeclarationService health)
    {
        var approvedOn = request.ApprovedOn ?? throw new DomainRuleViolationException(ViolationKind.Validation, "approvedOn.required", "Give the approval date.", "approvedOn");
        return Results.Ok(ToResponse(await health.RecordMedicalApprovalAsync(TenantRouteFilter.Current(httpContext), personId, approvedOn, httpContext.RequestAborted)));
    }

    private static MyHealthDeclarationResponse ToResponse(MyHealthDeclarationView view) =>
        new(ToResponse(view.Declaration), ToResponse(view.Form), view.Required);

    private static HealthDeclarationStatusResponse ToResponse(HealthStatusView view) =>
        new(view.Status, view.DeclarationId, view.FormVersion, view.SignerRole, view.SignedAt, view.ExpiresAt, view.MedicalApprovalOn);

    private static HealthFormResponse ToResponse(HealthForm form) =>
        new(form.Version, form.Locale, [.. form.Questions.Select(q => new HealthFormQuestionResponse(q.Id, q.Text))]);
}

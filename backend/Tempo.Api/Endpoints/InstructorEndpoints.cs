using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// Instructor profiles and the instructor's note to a class (docs/33 sections 5 and 7). Every member reads the
/// profiles; a staff member edits their own, `schedule.manage` edits anyone's (checked by the service).
/// </summary>
public static class InstructorEndpoints
{
    public static IEndpointRouteBuilder MapInstructorEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/instructors", ListAsync).RequirePermission(Permissions.ScheduleView).WithName("listInstructors").Produces<InstructorListResponse>();
        tenant.MapGet("/instructors/{membershipId:guid}", GetAsync).RequirePermission(Permissions.ScheduleView).WithName("getInstructor").Produces<InstructorProfileResponse>();
        tenant.MapPut("/instructors/{membershipId:guid}/profile", SaveAsync).RequirePermission(Permissions.ScheduleView).WithName("saveInstructorProfile").Produces<InstructorProfileResponse>();
        tenant.MapPut("/me/staff-profile", SaveMineAsync).RequirePermission(Permissions.ScheduleView).WithName("saveMyStaffProfile").Produces<InstructorProfileResponse>();
        tenant.MapPut("/sessions/{sessionId:guid}/member-note", SetNoteAsync).RequirePermission(Permissions.ScheduleView).WithName("setSessionMemberNote").Produces<SessionResponse>();

        return endpoints;
    }

    private static async Task<IResult> ListAsync(HttpContext httpContext, IInstructorService instructors) =>
        Results.Ok(new InstructorListResponse([.. (await instructors.ListAsync(TenantRouteFilter.Current(httpContext), httpContext.RequestAborted)).Select(ToResponse)]));

    private static async Task<IResult> GetAsync(HttpContext httpContext, Guid membershipId, IInstructorService instructors) =>
        Results.Ok(ToResponse(await instructors.GetAsync(TenantRouteFilter.Current(httpContext), membershipId, httpContext.RequestAborted)));

    private static async Task<IResult> SaveAsync(HttpContext httpContext, Guid membershipId, StaffProfileRequest request, IInstructorService instructors) =>
        Results.Ok(ToResponse(await instructors.SaveAsync(TenantRouteFilter.Current(httpContext), membershipId, Input(request), httpContext.RequestAborted)));

    private static async Task<IResult> SaveMineAsync(HttpContext httpContext, StaffProfileRequest request, IInstructorService instructors) =>
        Results.Ok(ToResponse(await instructors.SaveAsync(TenantRouteFilter.Current(httpContext), null, Input(request), httpContext.RequestAborted)));

    private static async Task<IResult> SetNoteAsync(HttpContext httpContext, Guid sessionId, MemberNoteRequest request, IInstructorService instructors) =>
        Results.Ok(ScheduleEndpoints.ToResponse(await instructors.SetMemberNoteAsync(TenantRouteFilter.Current(httpContext), sessionId, request.Note, request.ApplyToWeekly == true, httpContext.RequestAborted)));

    private static StaffProfileInput Input(StaffProfileRequest r) => new(r.Headline, r.Bio, r.InstagramHandle, r.PlaylistUrl, r.Visible);

    private static InstructorProfileResponse ToResponse(InstructorProfileView p) =>
        new(
            p.MembershipId,
            p.DisplayName,
            p.Headline,
            p.Bio,
            p.InstagramHandle,
            p.PlaylistUrl,
            MediaLinks.Url(p.PhotoMediaId),
            MediaLinks.Url(p.PhotoMediaId, small: true),
            p.Visible,
            p.NextSessions.Count == 0 ? null : [.. p.NextSessions.Select(ScheduleEndpoints.ToResponse)]);
}

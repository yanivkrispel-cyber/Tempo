using Tempo.Api.Tenancy;
using Tempo.Contracts.Api.Scheduling;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Application;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.Scheduling.Application;

namespace Tempo.Api.Endpoints;

/// <summary>
/// The member home in one read (S-2, board #511). It answers with what the home's eight reads answer for the same
/// caller (the studio, upcoming bookings, the week's classes, progress, passes, profile, the first inbox page and the
/// instructors), through the same services and mappers, so the app can fill each read's cache from it. Those reads
/// stay. The parts run one after another: eight short queries on the server are cheaper than eight requests from a
/// phone, and one at a time keeps one pooled connection per request.
/// </summary>
public static class HomeEndpoints
{
    /// <summary>The first inbox page the home's bell reads (the app's `useInbox` asks for 30).</summary>
    private const int InboxPage = 30;

    /// <summary>As the app's `useUpcomingBookings`.</summary>
    private const int UpcomingLimit = 100;

    public static IEndpointRouteBuilder MapHomeEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var tenant = endpoints.MapTenantGroup();

        tenant.MapGet("/me/home", GetAsync).RequirePermission(Permissions.ScheduleView).WithName("getMyHome").Produces<MyHomeResponse>();

        return endpoints;
    }

    private static async Task<IResult> GetAsync(
        HttpContext httpContext,
        IOrganizationService organizations,
        IBookingService bookings,
        ITimetableService timetable,
        IProgressService progress,
        IPassService passes,
        IConsentService consents,
        IStudioSettingsService settings,
        IInstructorService instructors,
        TimeProvider clock)
    {
        var tenant = TenantRouteFilter.Current(httpContext);
        var cancellationToken = httpContext.RequestAborted;

        // The route asks for schedule.view; the studio, the profile and the inbox are organization.view reads.
        if (!tenant.Has(Permissions.OrganizationView))
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "You do not have permission to do this.");
        }

        var studio = await organizations.GetAsync(tenant, cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(studio.TimeZone)).DateTime);
        var from = today.AddDays(-(int)today.DayOfWeek);
        var to = from.AddDays(6);

        var upcoming = await bookings.ListMineAsync(tenant, true, null, UpcomingLimit, cancellationToken);
        var sessions = await timetable.ListSessionsAsync(tenant, new SessionQuery(from, to, null, null), cancellationToken);
        var myProgress = await progress.GetMineAsync(tenant, cancellationToken);
        var myPasses = await passes.ListMineAsync(tenant, cancellationToken);
        var profile = await consents.GetMyProfileAsync(tenant, cancellationToken);
        var inbox = await settings.ListInboxAsync(tenant, null, InboxPage, cancellationToken);
        var team = await instructors.ListAsync(tenant, cancellationToken);

        return Results.Ok(new MyHomeResponse(
            OrganizationEndpoints.ToResponse(studio),
            BookingEndpoints.ToResponse(upcoming).Items,
            new MyHomeWeekResponse(from, to, [.. sessions.Select(ScheduleEndpoints.ToResponse)]),
            ProgressEndpoints.ToResponse(myProgress),
            [.. myPasses.Select(PassEndpoints.ToResponse)],
            PeopleEndpoints.ToResponse(profile),
            ClassEndpoints.ToResponse(inbox),
            [.. team.Select(InstructorEndpoints.ToResponse)]));
    }
}

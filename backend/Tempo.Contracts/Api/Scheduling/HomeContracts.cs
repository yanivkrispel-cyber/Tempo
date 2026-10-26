using Tempo.Contracts.Api.Organizations;
using Tempo.Contracts.Api.People;

namespace Tempo.Contracts.Api.Scheduling;

/// <summary>`MyHome`: what the member home shows, in the shapes of the reads it replaces (S-2, board #511).</summary>
public sealed record MyHomeResponse(
    OrganizationResponse Studio,
    IReadOnlyList<MyBookingResponse> UpcomingBookings,
    MyHomeWeekResponse Week,
    MyProgressResponse Progress,
    IReadOnlyList<PassResponse> Passes,
    PersonDetailResponse Profile,
    InboxPageResponse Notifications,
    IReadOnlyList<InstructorProfileResponse> Instructors);

/// <summary>The studio's week, Sunday to Saturday on its clock, and its classes as `GET /sessions` lists them.</summary>
public sealed record MyHomeWeekResponse(DateOnly From, DateOnly To, IReadOnlyList<SessionResponse> Sessions);

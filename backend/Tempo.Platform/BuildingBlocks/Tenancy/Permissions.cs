namespace Tempo.Platform.BuildingBlocks.Tenancy;

/// <summary>
/// The Phase 2 permission catalog (docs/27_Authorization_and_People_LLD.md
/// section 3.1). A key never changes meaning; the database stores keys as text
/// and migration 0005 seeds the system roles with these sets.
/// </summary>
public static class Permissions
{
    public const string OrganizationView = "organization.view";
    public const string OrganizationSettingsManage = "organization.settings.manage";
    public const string MembersView = "members.view";
    public const string MembersInviteStaff = "members.invite.staff";
    public const string MembersInviteAdmin = "members.invite.admin";
    public const string MembersManage = "members.manage";
    public const string RolesManage = "roles.manage";
    public const string AuditView = "audit.view";
    public const string PeopleView = "people.view";
    public const string PeopleManage = "people.manage";
    public const string PeopleMerge = "people.merge";
    public const string PeopleExport = "people.export";
    public const string PeopleErase = "people.erase";
    public const string ConsentManage = "consent.manage";
    public const string OwnershipTransfer = "ownership.transfer";

    // Studio scheduling and passes (docs/29 section 8), seeded by migration 0010.
    public const string ScheduleView = "schedule.view";
    public const string ScheduleManage = "schedule.manage";
    public const string BookingsManage = "bookings.manage";
    public const string AttendanceMark = "attendance.mark";
    public const string PassesView = "passes.view";
    public const string PassesManage = "passes.manage";

    // Thin billing (docs/28 section 8), seeded by migration 0009.
    public const string BillingView = "billing.view";
    public const string BillingManage = "billing.manage";

    // The health declaration (docs/31 section 5), seeded by migration 0018 for the owner role only.
    public const string HealthView = "health.view";

    /// <summary>Every key with what it allows, for the role screen (`GET /permissions`).</summary>
    public static readonly IReadOnlyDictionary<string, string> Catalog = new Dictionary<string, string>
    {
        [OrganizationView] = "Read the studio",
        [OrganizationSettingsManage] = "Edit the studio's name, locale and time zone",
        [MembersView] = "List members",
        [MembersInviteStaff] = "Invite staff and clients, manage the join link",
        [MembersInviteAdmin] = "Invite admins",
        [MembersManage] = "Change a member's status and assign roles weaker than your own",
        [RolesManage] = "Create and edit custom roles, assign any role but owner",
        [AuditView] = "Read the studio's audit log",
        [PeopleView] = "List and read person records",
        [PeopleManage] = "Create and edit people, contact points and relationships",
        [PeopleMerge] = "Resolve duplicate people",
        [PeopleExport] = "Export one person's data",
        [PeopleErase] = "Anonymize a person",
        [ConsentManage] = "Record consent on someone's behalf",
        [OwnershipTransfer] = "Start an owner transfer",
        [ScheduleView] = "See the timetable",
        [ScheduleManage] = "Manage rooms, class types, weekly classes, sessions and the booking policy",
        [BookingsManage] = "Book and cancel for others, read any class roster",
        [AttendanceMark] = "Mark attendance on any class",
        [PassesView] = "See pass products and anyone's passes",
        [PassesManage] = "Create pass products, grant and void passes",
        [BillingView] = "See the studio's plan and billing details",
        [BillingManage] = "Change the studio's billing details",
        [HealthView] = "Read health declaration answers and record medical approval"
    };
}

/// <summary>One of the four roles every studio has (docs/27 section 3.2), with its fixed id from migration 0005.</summary>
public sealed record SystemRole(Guid Id, MembershipRole Role, string Key, string DisplayName, IReadOnlySet<string> Permissions);

public static class SystemRoles
{
    public static readonly SystemRole Owner = new(
        Guid.Parse("00000000-0000-7000-8000-000000000001"),
        MembershipRole.Owner,
        "owner",
        "בעלים",
        Permissions.Catalog.Keys.ToHashSet());

    public static readonly SystemRole Admin = new(
        Guid.Parse("00000000-0000-7000-8000-000000000002"),
        MembershipRole.Admin,
        "admin",
        "מנהל",
        new HashSet<string>
        {
            Permissions.OrganizationView, Permissions.OrganizationSettingsManage, Permissions.MembersView,
            Permissions.MembersInviteStaff, Permissions.MembersManage, Permissions.AuditView, Permissions.PeopleView,
            Permissions.PeopleManage, Permissions.PeopleMerge, Permissions.PeopleExport, Permissions.ConsentManage,
            Permissions.ScheduleView, Permissions.ScheduleManage, Permissions.BookingsManage, Permissions.AttendanceMark,
            Permissions.PassesView, Permissions.PassesManage, Permissions.BillingView
        });

    public static readonly SystemRole Staff = new(
        Guid.Parse("00000000-0000-7000-8000-000000000003"),
        MembershipRole.Staff,
        "staff",
        "צוות",
        new HashSet<string>
        {
            Permissions.OrganizationView, Permissions.MembersView, Permissions.PeopleView, Permissions.PeopleManage,
            Permissions.ScheduleView, Permissions.BookingsManage, Permissions.AttendanceMark, Permissions.PassesView
        });

    public static readonly SystemRole Client = new(
        Guid.Parse("00000000-0000-7000-8000-000000000004"),
        MembershipRole.Client,
        "client",
        "מתאמן",
        new HashSet<string> { Permissions.OrganizationView, Permissions.ScheduleView });

    public static readonly IReadOnlyList<SystemRole> All = [Owner, Admin, Staff, Client];

    public static SystemRole Of(MembershipRole role) => role switch
    {
        MembershipRole.Owner => Owner,
        MembershipRole.Admin => Admin,
        MembershipRole.Staff => Staff,
        _ => Client
    };
}

/// <summary>A role as `RoleSummary` in the contract.</summary>
public sealed record RoleSummary(Guid Id, string Key, string DisplayName, bool IsSystem)
{
    public static RoleSummary Of(SystemRole role) => new(role.Id, role.Key, role.DisplayName, true);
}

/// <summary>A pending owner transfer as one side of it sees it in `GET /me`.</summary>
public sealed record PendingOwnershipTransfer(Guid Id, string Direction, DateTimeOffset ExpiresAt);

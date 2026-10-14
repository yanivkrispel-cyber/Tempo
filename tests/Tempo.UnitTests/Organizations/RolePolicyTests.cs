using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Organizations.Domain;
using Xunit;
using static Tempo.Platform.BuildingBlocks.Tenancy.MembershipRole;

namespace Tempo.UnitTests.Organizations;

/// <summary>Every cell of docs/26 section 4.1, plus the route table of section 8.2.</summary>
public sealed class RolePolicyTests
{
    [Theory]
    [InlineData(Owner, true, true, true, true)]
    [InlineData(Admin, true, true, true, true)]
    [InlineData(Staff, false, true, false, false)]
    [InlineData(Client, false, false, false, false)]
    public void StudioCapabilities(MembershipRole actor, bool edit, bool listMembers, bool audit, bool joinLink)
    {
        RolePolicy.CanViewOrganization(actor).Should().BeTrue("any member reads the studio");
        RolePolicy.CanEditOrganization(actor).Should().Be(edit);
        RolePolicy.CanListMembers(actor).Should().Be(listMembers);
        RolePolicy.CanViewAudit(actor).Should().Be(audit);
        RolePolicy.CanManageJoinLink(actor).Should().Be(joinLink);
    }

    [Theory]
    [InlineData(Owner, Admin, true)]
    [InlineData(Owner, Staff, true)]
    [InlineData(Owner, Client, true)]
    [InlineData(Owner, Owner, false)]
    [InlineData(Admin, Admin, false)]
    [InlineData(Admin, Staff, true)]
    [InlineData(Admin, Client, true)]
    [InlineData(Staff, Staff, false)]
    [InlineData(Staff, Client, false)]
    [InlineData(Client, Client, false)]
    public void Invite(MembershipRole actor, MembershipRole invited, bool allowed) =>
        RolePolicy.CanInvite(actor, invited).Should().Be(allowed);

    [Theory]
    // the owner changes anyone but themselves
    [InlineData(Owner, Admin, Staff, true)]
    [InlineData(Owner, Staff, Admin, true)]
    [InlineData(Owner, Client, null, true)]
    // admins change staff and clients only, and only to staff or client
    [InlineData(Admin, Staff, Client, true)]
    [InlineData(Admin, Client, Staff, true)]
    [InlineData(Admin, Client, null, true)]
    [InlineData(Admin, Staff, Admin, false)]
    [InlineData(Admin, Admin, Staff, false)]
    [InlineData(Admin, Owner, null, false)]
    // staff and clients change nobody
    [InlineData(Staff, Client, null, false)]
    [InlineData(Client, Client, null, false)]
    // nobody touches the owner or grants the owner role
    [InlineData(Owner, Admin, Owner, false)]
    public void ChangeAnotherMember(MembershipRole actor, MembershipRole target, MembershipRole? newRole, bool allowed) =>
        RolePolicy.CanChangeMember(actor, isSelf: false, target, newRole).Should().Be(allowed);

    [Theory]
    [InlineData(Owner)]
    [InlineData(Admin)]
    [InlineData(Staff)]
    public void NobodyChangesTheirOwnMembership(MembershipRole actor) =>
        RolePolicy.CanChangeMember(actor, isSelf: true, actor, newRole: null).Should().BeFalse();

    [Theory]
    [InlineData(Owner, Admin, true)]
    [InlineData(Owner, Client, true)]
    [InlineData(Admin, Staff, true)]
    [InlineData(Admin, Client, true)]
    [InlineData(Admin, Admin, false)]
    [InlineData(Admin, Owner, false)]
    [InlineData(Staff, Client, false)]
    [InlineData(Client, Staff, false)]
    public void RemoveAnotherMember(MembershipRole actor, MembershipRole target, bool allowed) =>
        RolePolicy.CanRemoveMember(actor, isSelf: false, target).Should().Be(allowed);

    [Theory]
    [InlineData(Owner, false)]
    [InlineData(Admin, true)]
    [InlineData(Staff, true)]
    [InlineData(Client, true)]
    public void Leave(MembershipRole role, bool allowed) =>
        RolePolicy.CanRemoveMember(role, isSelf: true, role).Should().Be(allowed);
}

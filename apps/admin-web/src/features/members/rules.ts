import type { Schemas } from "@tempo/api-client";
import { systemRoleOf, type MyMembership } from "../../account/account";

type Member = Schemas["Member"];
type InvitableRole = Schemas["InvitableRole"];

/**
 * The rules for changing someone else (contract, PATCH /members/{id}): nobody changes themselves or the owner, and
 * the owner role is never granted here; the owner changes anyone else, an admin only staff and clients. Roles come
 * from `roles` (their system role), never the deprecated `role` field. The app uses the rules to offer only what the
 * API will accept; the API enforces them.
 */
function outranks(actor: MyMembership, target: Member): boolean {
  const actorRole = systemRoleOf(actor.roles);
  const targetRole = systemRoleOf(target.roles);
  if (target.id === actor.membershipId || targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  return actorRole === "admin" && (targetRole === "staff" || targetRole === "client");
}

/** The roles the caller may give this member, other than the one they hold. */
export function assignableRoles(actor: MyMembership, target: Member): InvitableRole[] {
  if (!outranks(actor, target)) return [];
  const roles: InvitableRole[] =
    systemRoleOf(actor.roles) === "owner" ? ["admin", "staff", "client"] : ["staff", "client"];
  const current = systemRoleOf(target.roles);
  return roles.filter((role) => role !== current);
}

export const canSuspend = (actor: MyMembership, target: Member) =>
  outranks(actor, target) && target.status === "active";
export const canReactivate = (actor: MyMembership, target: Member) =>
  outranks(actor, target) && target.status === "suspended";
export const canRemove = (actor: MyMembership, target: Member) =>
  outranks(actor, target) && target.status !== "removed";

/** Only the owner hands over the studio, to an active admin, one offer at a time (docs/27 section 3.5). */
export const canOfferOwnership = (actor: MyMembership, target: Member) =>
  systemRoleOf(actor.roles) === "owner" &&
  systemRoleOf(target.roles) === "admin" &&
  target.status === "active" &&
  !actor.pendingOwnershipTransfer;

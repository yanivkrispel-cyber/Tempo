import type { Schemas } from "@tempo/api-client";
import type { MyMembership } from "../../account/account";

type Member = Schemas["Member"];
type InvitableRole = Schemas["InvitableRole"];

/**
 * The Phase 1 rules for changing someone else (contract, PATCH /members/{id}): nobody changes themselves or the
 * owner, and the owner role is never granted here; the owner changes anyone else, an admin only staff and clients.
 * The app uses them to offer only what the API will accept; the API enforces them.
 */
function outranks(actor: MyMembership, target: Member): boolean {
  if (target.id === actor.membershipId || target.role === "owner") return false;
  if (actor.role === "owner") return true;
  return actor.role === "admin" && (target.role === "staff" || target.role === "client");
}

/** The roles the caller may give this member, other than the one they hold. */
export function assignableRoles(actor: MyMembership, target: Member): InvitableRole[] {
  if (!outranks(actor, target)) return [];
  const roles: InvitableRole[] = actor.role === "owner" ? ["admin", "staff", "client"] : ["staff", "client"];
  return roles.filter((role) => role !== target.role);
}

export const canSuspend = (actor: MyMembership, target: Member) =>
  outranks(actor, target) && target.status === "active";
export const canReactivate = (actor: MyMembership, target: Member) =>
  outranks(actor, target) && target.status === "suspended";
export const canRemove = (actor: MyMembership, target: Member) =>
  outranks(actor, target) && target.status !== "removed";

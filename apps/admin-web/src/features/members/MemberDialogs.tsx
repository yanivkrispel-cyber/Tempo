import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState } from "react";
import { useLocation } from "react-router";
import { roleName, rolesLabel } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { Banner, Button, Dialog, Field, Select, useToast } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { systemRoleIds } from "../roles/catalog";

type Member = Schemas["Member"];
type InvitableRole = Schemas["InvitableRole"];

export const nameOfMember = (member: Member) =>
  member.displayName?.trim() || member.email.split("@")[0] || member.email;

function useMembersKey() {
  const { organizationId } = useStudio();
  return ["studio", organizationId, "members"] as const;
}

/** PATCH /members/{id} with the version the row was read at (If-Match); a stale row answers 409. */
export function useUpdateMember() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  const key = useMembersKey();
  return useMutation({
    mutationKey: [organizationId, "members.updateMember"],
    mutationFn: ({ member, body }: { member: Member; body: Schemas["UpdateMemberRequest"] }) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}/members/{membershipId}", {
          params: { path: { organizationId, membershipId: member.id }, header: { "If-Match": member.version } },
          body,
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/**
 * PUT /members/{id}/roles with the one system role (docs/27 section 6). Granting admin needs a recent sign-in:
 * the API answers 401 auth.step_up_required, and the dialog offers to sign in again.
 */
export function useSetMemberRole() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  const key = useMembersKey();
  return useMutation({
    mutationKey: [organizationId, "members.setMemberRole"],
    mutationFn: ({ member, role }: { member: Member; role: InvitableRole }) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/members/{membershipId}/roles", {
          params: { path: { organizationId, membershipId: member.id }, header: { "If-Match": member.version } },
          body: { roleIds: [systemRoleIds[role]] },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function RoleDialog({
  member,
  roles,
  onClose,
}: {
  member: Member;
  roles: InvitableRole[];
  onClose: () => void;
}) {
  const [role, setRole] = useState<InvitableRole>(roles[0]!);
  const update = useSetMemberRole();
  const toast = useToast();
  const { client } = useAuth();
  const { pathname } = useLocation();
  const stepUp = hasCode(update.error, "auth.step_up_required");

  const save = () =>
    update.mutate(
      { member, role },
      {
        onSuccess: () => {
          toast.show({ tone: "success", icon: "check", message: `${nameOfMember(member)}: ${roleName(role)}` });
          onClose();
        },
      },
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title="שינוי תפקיד"
      description={`התפקיד הנוכחי של ${nameOfMember(member)}: ${rolesLabel(member.roles)}.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button loading={update.isPending} onClick={save}>
            שמירה
          </Button>
        </>
      }
    >
      <div className="tp-stack">
        <Field label="תפקיד חדש">
          <Select value={role} onChange={(event) => setRole(event.target.value as InvitableRole)}>
            {roles.map((option) => (
              <option key={option} value={option}>
                {roleName(option)}
              </option>
            ))}
          </Select>
        </Field>
        {update.isError && (
          <Banner tone={stepUp ? "warning" : "danger"} icon="info">
            {errorMessage(update.error, "לא הצלחנו לשנות את התפקיד. נסו שוב.")}
          </Banner>
        )}
        {stepUp && (
          <Button variant="secondary" icon="log-out" onClick={() => void client?.signIn(pathname, "reauthenticate")}>
            התחברות מחדש
          </Button>
        )}
      </div>
    </Dialog>
  );
}

export function RemoveDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId, displayName } = useStudio();
  const key = useMembersKey();
  const remove = useMutation({
    mutationKey: [organizationId, "members.remove"],
    mutationFn: () =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/members/{membershipId}", {
          params: { path: { organizationId, membershipId: member.id } },
        }),
      ),
    onSuccess: () => {
      toast.show({ tone: "success", icon: "check", message: `הסרנו את ${nameOfMember(member)} מהסטודיו` });
      onClose();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="הסרה מהסטודיו"
      description={`אחרי ההסרה לא תהיה ל${nameOfMember(member)} גישה ל${displayName}. אפשר להזמין שוב בכל עת.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            הסרה
          </Button>
        </>
      }
    >
      {remove.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(remove.error, "לא הצלחנו להסיר. נסו שוב.")}
        </Banner>
      )}
    </Dialog>
  );
}

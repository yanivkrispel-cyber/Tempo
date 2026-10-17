import { useInfiniteQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState } from "react";
import { rolesLabel, systemRoleOf } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Chip,
  type ChipTone,
  DropdownMenu,
  type MenuEntry,
  Skeleton,
  TableScroll,
  useToast,
} from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";
import { OutgoingTransferBanner, TransferDialog } from "../ownership/Ownership";
import { InstructorProfileDialog } from "./InstructorProfileDialog";
import { RemoveDialog, RoleDialog, nameOfMember, useUpdateMember } from "./MemberDialogs";
import { assignableRoles, canOfferOwnership, canReactivate, canRemove, canSuspend } from "./rules";

type Member = Schemas["Member"];

const pageSize = 50;

const statusLabel: Record<Member["status"], { text: string; tone: ChipTone }> = {
  active: { text: "פעיל", tone: "success" },
  invited: { text: "הוזמן", tone: "info" },
  suspended: { text: "מושעה", tone: "warning" },
  removed: { text: "הוסר", tone: "danger" },
};

/** The member's roles, from `roles` (the deprecated `role` field is not read). */
const memberRole = (member: Member) => rolesLabel(member.roles);

export function useMembers() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useInfiniteQuery({
    queryKey: ["studio", organizationId, "members"],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/members", {
          params: { path: { organizationId }, query: { limit: pageSize, before: pageParam ?? undefined } },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore ?? null,
  });
}

/** `/o/:slug`: the studio's members, newest first (GET /members, keyset pages). */
export function MembersPage() {
  const members = useMembers();
  const studio = useStudio();
  const rows = members.data?.pages.flatMap((page) => page.items) ?? [];
  const [dialog, setDialog] = useState<{ kind: "role" | "remove" | "transfer"; member: Member } | null>(null);
  const [profile, setProfile] = useState<{ membershipId: string; name: string } | null>(null);
  const update = useUpdateMember();
  const toast = useToast();
  const manages = studio.can("members.manage");

  const setStatus = (member: Member, status: "active" | "suspended") =>
    update.mutate(
      { member, body: { status } },
      {
        onSuccess: () =>
          toast.show({
            tone: "success",
            icon: "check",
            message:
              status === "suspended"
                ? `השעינו את ${nameOfMember(member)}`
                : `החזרנו את ${nameOfMember(member)} לפעילות`,
          }),
        onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
      },
    );

  const actionsFor = (member: Member): MenuEntry[] => {
    const actor = studio.membership;
    const roles = assignableRoles(actor, member);
    const entries: MenuEntry[] = [];
    if (roles.length > 0) entries.push({ label: "שינוי תפקיד", onSelect: () => setDialog({ kind: "role", member }) });
    if (studio.can("schedule.manage") && member.status === "active" && systemRoleOf(member.roles) !== "client")
      entries.push({
        label: "פרופיל מדריך",
        onSelect: () => setProfile({ membershipId: member.id, name: nameOfMember(member) }),
      });
    if (canSuspend(actor, member)) entries.push({ label: "השעיה", onSelect: () => setStatus(member, "suspended") });
    if (canReactivate(actor, member))
      entries.push({ label: "החזרה לפעילות", onSelect: () => setStatus(member, "active") });
    if (studio.can("ownership.transfer") && canOfferOwnership(actor, member))
      entries.push({ label: "העברת הבעלות", onSelect: () => setDialog({ kind: "transfer", member }) });
    if (canRemove(actor, member))
      entries.push("separator", {
        label: "הסרה מהסטודיו",
        danger: true,
        onSelect: () => setDialog({ kind: "remove", member }),
      });
    return entries;
  };

  return (
    <>
      <header className="tp-row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="tp-eyebrow">ניהול</span>
          <h1>חברי הסטודיו</h1>
        </div>
        <Button
          variant="secondary"
          icon="user"
          onClick={() => setProfile({ membershipId: studio.membership.membershipId, name: "הפרופיל שלי" })}
        >
          פרופיל המדריך שלי
        </Button>
      </header>

      <OutgoingTransferBanner />

      {members.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(members.error, "לא הצלחנו לטעון את החברים. נסו שוב.")}
        </Banner>
      ) : !members.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את החברים…</span>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : (
        <TableScroll label="חברי הסטודיו">
          <table className="tp-table tp-table--stack">
            <caption className="tp-sr-only">חברי הסטודיו</caption>
            <thead>
              <tr>
                <th scope="col">שם</th>
                <th scope="col">מייל</th>
                <th scope="col">תפקיד</th>
                <th scope="col">מצב</th>
                <th scope="col">הצטרפות</th>
                {manages && (
                  <th scope="col">
                    <span className="tp-sr-only">פעולות</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => (
                <tr key={member.id}>
                  <td>{nameOfMember(member)}</td>
                  <td data-label="מייל">
                    <bdi className="tp-ltr">{member.email}</bdi>
                  </td>
                  <td data-label="תפקיד">{memberRole(member)}</td>
                  <td data-label="מצב">
                    <Chip tone={statusLabel[member.status].tone}>{statusLabel[member.status].text}</Chip>
                  </td>
                  <td data-label="הצטרפות" className="tp-num">
                    {formatDate(toIsoDate(new Date(member.joinedAt)))}
                  </td>
                  {manages && (
                    <td className="tp-table__end">
                      {actionsFor(member).length > 0 && (
                        <DropdownMenu label="פעולות" variant="ghost" size="sm" items={actionsFor(member)}>
                          {/* The space is a text node of its own: inside the hidden span it would be trimmed from the name. */}{" "}
                          <span className="tp-sr-only">עבור {nameOfMember(member)}</span>
                        </DropdownMenu>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {dialog?.kind === "role" && (
        <RoleDialog
          member={dialog.member}
          roles={assignableRoles(studio.membership, dialog.member)}
          onClose={() => setDialog(null)}
        />
      )}
      {profile && (
        <InstructorProfileDialog
          membershipId={profile.membershipId}
          name={profile.name}
          onClose={() => setProfile(null)}
        />
      )}
      {dialog?.kind === "remove" && <RemoveDialog member={dialog.member} onClose={() => setDialog(null)} />}
      {dialog?.kind === "transfer" && (
        <TransferDialog member={dialog.member} name={nameOfMember(dialog.member)} onClose={() => setDialog(null)} />
      )}

      {members.hasNextPage && (
        <div>
          <Button variant="secondary" loading={members.isFetchingNextPage} onClick={() => void members.fetchNextPage()}>
            עוד חברים
          </Button>
        </div>
      )}
    </>
  );
}

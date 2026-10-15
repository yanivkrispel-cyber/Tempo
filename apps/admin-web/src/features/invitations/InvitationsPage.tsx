import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { roleName } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { CopyLink } from "../../shared/CopyLink";
import {
  Banner,
  Button,
  Card,
  Chip,
  Dialog,
  Field,
  Input,
  Segmented,
  Select,
  Skeleton,
  useToast,
  type ChipTone,
} from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";

type Invitation = Schemas["Invitation"];
type InvitableRole = Schemas["InvitableRole"];

const statusLabel: Record<Invitation["status"], { text: string; tone: ChipTone }> = {
  pending: { text: "ממתינה", tone: "info" },
  accepted: { text: "התקבלה", tone: "success" },
  revoked: { text: "בוטלה", tone: "danger" },
  expired: { text: "פג תוקף", tone: "warning" },
};

const day = (iso: string) => formatDate(toIsoDate(new Date(iso)));

/** `/o/:slug/invitations`: invite by email, see and revoke invitations, and the studio's join link for clients. */
export function InvitationsPage() {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [inviting, setInviting] = useState(false);
  const invitations = useInvitations(filter);
  const rows = invitations.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <header className="tp-row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="tp-eyebrow">ניהול</span>
          <h1>הזמנות</h1>
        </div>
        <Button icon="plus" onClick={() => setInviting(true)}>
          הזמנה חדשה
        </Button>
      </header>

      <JoinLinkCard />

      <section className="tp-stack" aria-labelledby="sent">
        <div className="tp-row" style={{ justifyContent: "space-between" }}>
          <h2 id="sent">הזמנות במייל</h2>
          <Segmented
            label="אילו הזמנות"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "pending", label: "ממתינות" },
              { value: "all", label: "כולן" },
            ]}
          />
        </div>

        {invitations.isError ? (
          <Banner tone="danger" icon="info">
            {errorMessage(invitations.error, "לא הצלחנו לטעון את ההזמנות. נסו שוב.")}
          </Banner>
        ) : !invitations.data ? (
          <div aria-busy="true" className="tp-stack">
            <span className="tp-sr-only">טוענים את ההזמנות…</span>
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : rows.length === 0 ? (
          <p className="tp-muted">{filter === "pending" ? "אין הזמנות שממתינות לתשובה." : "עוד לא נשלחו הזמנות."}</p>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <caption className="tp-sr-only">הזמנות במייל</caption>
              <thead>
                <tr>
                  <th scope="col">מייל</th>
                  <th scope="col">תפקיד</th>
                  <th scope="col">מצב</th>
                  <th scope="col">בתוקף עד</th>
                  <th scope="col">הוזמן על ידי</th>
                  <th scope="col">
                    <span className="tp-sr-only">פעולות</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invitation) => (
                  <InvitationRow key={invitation.id} invitation={invitation} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {invitations.hasNextPage && (
          <div>
            <Button
              variant="secondary"
              loading={invitations.isFetchingNextPage}
              onClick={() => void invitations.fetchNextPage()}
            >
              עוד הזמנות
            </Button>
          </div>
        )}
      </section>

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </>
  );
}

function useInvitationsKey() {
  const { organizationId } = useStudio();
  return ["studio", organizationId, "invitations"] as const;
}

function useInvitations(filter: "pending" | "all") {
  const api = useApi();
  const { organizationId } = useStudio();
  return useInfiniteQuery({
    queryKey: [...useInvitationsKey(), filter],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/invitations", {
          params: {
            path: { organizationId },
            query: { status: filter === "pending" ? "pending" : undefined, limit: 50, before: pageParam ?? undefined },
          },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore ?? null,
  });
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const key = useInvitationsKey();
  const revoke = useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/invitations/{invitationId}", {
          params: { path: { organizationId, invitationId: invitation.id } },
        }),
      ),
    onSuccess: () => toast.show({ tone: "success", icon: "check", message: `ההזמנה ל־${invitation.email} בוטלה` }),
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return (
    <tr>
      <td>
        <bdi className="tp-ltr">{invitation.email}</bdi>
      </td>
      <td>{roleName(invitation.role)}</td>
      <td>
        <Chip tone={statusLabel[invitation.status].tone}>{statusLabel[invitation.status].text}</Chip>
      </td>
      <td className="tp-num">{day(invitation.expiresAt)}</td>
      <td>{invitation.invitedBy?.displayName ?? "—"}</td>
      <td>
        {invitation.status === "pending" && (
          <Button
            variant="ghost-danger"
            size="sm"
            loading={revoke.isPending}
            onClick={() => revoke.mutate()}
            aria-label={`ביטול ההזמנה ל־${invitation.email}`}
          >
            ביטול
          </Button>
        )}
      </td>
    </tr>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const studio = useStudio();
  const key = useInvitationsKey();
  // Admins invite staff and clients; only someone with members.invite.admin (the owner) invites admins.
  const roles: InvitableRole[] = studio.can("members.invite.admin")
    ? ["client", "staff", "admin"]
    : ["client", "staff"];
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("staff");
  const [submitted, setSubmitted] = useState(false);
  const create = useMutation({
    mutationFn: (body: Schemas["CreateInvitationRequest"]) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/invitations", {
          params: { path: { organizationId: studio.organizationId } },
          body,
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const address = email.trim();
  const invalid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? null : "כתובת מייל לא תקינה";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!invalid) create.mutate({ email: address, role });
  };

  if (create.data) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="ההזמנה מוכנה"
        description={`שלחו את הקישור ל־${create.data.email}. הוא בתוקף עד ${day(create.data.expiresAt)}.`}
        actions={<Button onClick={onClose}>סיום</Button>}
      >
        <CopyLink link={create.data.link} label="קישור ההזמנה" />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="הזמנה חדשה"
      description="Tempo עוד לא שולחת מיילים: אחרי היצירה תקבלו קישור לשלוח בעצמכם."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="invite" loading={create.isPending}>
            יצירת הזמנה
          </Button>
        </>
      }
    >
      <form id="invite" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="מייל" required error={submitted ? invalid : undefined}>
          <Input
            type="email"
            dir="ltr"
            className="tp-ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="תפקיד" help={role === "client" ? "מתאמנים מצטרפים בדרך כלל בקישור ההצטרפות." : undefined}>
          <Select value={role} onChange={(event) => setRole(event.target.value as InvitableRole)}>
            {roles.map((option) => (
              <option key={option} value={option}>
                {roleName(option)}
              </option>
            ))}
          </Select>
        </Field>
        {create.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(create.error, "לא הצלחנו ליצור את ההזמנה. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

function JoinLinkCard() {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const organizationKey = ["studio", organizationId, "organization"] as const;
  const organization = useQuery({
    queryKey: organizationKey,
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}", { params: { path: { organizationId } } })),
  });
  const [link, setLink] = useState<string | null>(null);

  const rotate = useMutation({
    mutationFn: () =>
      unwrap(api.PUT("/api/v1/organizations/{organizationId}/join-link", { params: { path: { organizationId } } })),
    onSuccess: (joinLink) => setLink(joinLink.link),
    onSettled: () => queryClient.invalidateQueries({ queryKey: organizationKey }),
  });
  const disable = useMutation({
    mutationFn: () =>
      unwrap(api.DELETE("/api/v1/organizations/{organizationId}/join-link", { params: { path: { organizationId } } })),
    onSuccess: () => {
      setLink(null);
      toast.show({ tone: "success", icon: "check", message: "קישור ההצטרפות כובה" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: organizationKey }),
  });

  const enabled = organization.data?.joinLinkEnabled ?? false;
  const error = rotate.error ?? disable.error ?? organization.error;

  return (
    <Card as="section" aria-labelledby="join-link" className="tp-stack">
      <h2 id="join-link">קישור הצטרפות למתאמנים</h2>
      <p className="tp-muted">
        מי שפותח את הקישור מצטרף לסטודיו כמתאמן, בלי הזמנה אישית. החלפת הקישור מבטלת את הקודם מיד.
      </p>
      {!organization.data && !organization.isError ? (
        <Skeleton height={40} />
      ) : (
        <>
          <p>
            <Chip tone={enabled ? "success" : "neutral"}>{enabled ? "פעיל" : "כבוי"}</Chip>
          </p>
          {link && <CopyLink link={link} label="קישור ההצטרפות החדש" />}
          {error && (
            <Banner tone="danger" icon="info">
              {errorMessage(error)}
            </Banner>
          )}
          <div className="tp-row">
            <Button
              variant={enabled ? "secondary" : "primary"}
              loading={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              {enabled ? "החלפת הקישור" : "יצירת קישור"}
            </Button>
            {enabled && (
              <Button variant="ghost-danger" loading={disable.isPending} onClick={() => disable.mutate()}>
                כיבוי הקישור
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

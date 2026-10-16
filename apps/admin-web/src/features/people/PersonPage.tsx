import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Chip,
  DateInput,
  Dialog,
  Field,
  Icon,
  Input,
  Select,
  Skeleton,
  useToast,
} from "../../shared/design-system";
import { formatDate, todayIso, toIsoDate, type IsoDate } from "../../shared/utilities/dates";
import { displayPhone } from "../../shared/utilities/phones";
import { useStudio } from "../console/studio";
import { PassesSection } from "../passes/PassesSection";
import { ConsentSection } from "./ConsentSection";
import { DeliveriesSection } from "./DeliveriesSection";
import { EraseDialog } from "./EraseDialog";
import { ExportButton } from "./ExportButton";
import { InvitePersonDialog } from "./InvitePersonDialog";
import { personStatus, sourceLabel } from "./labels";
import { RelationshipsSection } from "./RelationshipsSection";

type PersonDetail = Schemas["PersonDetail"];
type ContactPoint = Schemas["ContactPoint"];

function usePersonKey(personId: string) {
  const { organizationId } = useStudio();
  return ["studio", organizationId, "person", personId] as const;
}

/** `/o/:slug/people/:personId`: one person record, its contact points, and edits (docs/27 sections 4.1 and 4.2). */
export function PersonPage() {
  const { personId = "" } = useParams();
  const api = useApi();
  const { organizationId } = useStudio();
  const person = useQuery({
    queryKey: usePersonKey(personId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people/{personId}", {
          params: { path: { organizationId, personId } },
        }),
      ),
  });

  if (person.isError) {
    return (
      <div className="tp-stack">
        <Banner tone="danger" icon="info">
          {hasCode(person.error, "person.not_found")
            ? "האדם לא נמצא."
            : errorMessage(person.error, "לא הצלחנו לטעון את הפרטים. נסו שוב.")}
        </Banner>
        <ButtonLink to=".." relative="path" variant="secondary">
          לרשימת האנשים
        </ButtonLink>
      </div>
    );
  }

  if (!person.data) {
    return (
      <div aria-busy="true" className="tp-stack">
        <span className="tp-sr-only">טוענים את הפרטים…</span>
        <Skeleton height={64} />
        <Skeleton height={200} />
      </div>
    );
  }

  return <PersonCard person={person.data} />;
}

function PersonCard({ person }: { person: PersonDetail }) {
  const studio = useStudio();
  const [editing, setEditing] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const status = personStatus[person.status];
  const writable = studio.can("people.manage") && (person.status === "active" || person.status === "archived");
  const archive = usePatchPerson(person);
  const toast = useToast();

  const setArchived = (archived: boolean) =>
    archive.mutate(
      { status: archived ? "archived" : "active" },
      {
        onSuccess: () =>
          toast.show({
            tone: "success",
            icon: "check",
            message: archived ? "הרשומה עברה לארכיון" : "הרשומה חזרה לרשימת הפעילים",
          }),
        onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
      },
    );

  return (
    <>
      <header className="tp-stack" style={{ gap: 6 }}>
        <ButtonLink to=".." relative="path" variant="ghost" size="sm" icon="chevron-right">
          אנשים
        </ButtonLink>
        <div className="tp-row">
          <h1>{person.displayName}</h1>
          <Chip tone={status.tone}>{status.text}</Chip>
          {person.hasLogin && <Chip tone="info">יש חשבון</Chip>}
          {/* An archived record would stay hidden from the active list after the person joins, so restore it first. */}
          {!person.hasLogin && person.status === "active" && studio.can("members.invite.staff") && (
            <Button variant="secondary" size="sm" icon="mail" onClick={() => setInviting(true)}>
              הזמנה לאפליקציה
            </Button>
          )}
        </div>
      </header>

      <Card as="section" aria-labelledby="details" className="tp-stack">
        <div className="tp-row" style={{ justifyContent: "space-between" }}>
          <h2 id="details">פרטים</h2>
          {(writable || studio.can("people.export")) && (
            <div className="tp-row">
              {studio.can("people.export") && <ExportButton personId={person.id} name={person.displayName} />}
              {writable && (
                <>
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing(true)}>
                    עריכה
                  </Button>
                  <Button
                    variant={person.status === "archived" ? "secondary" : "ghost-danger"}
                    size="sm"
                    loading={archive.isPending}
                    onClick={() => setArchived(person.status !== "archived")}
                  >
                    {person.status === "archived" ? "החזרה מהארכיון" : "העברה לארכיון"}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <dl className="tp-grid" style={{ gridTemplateColumns: "max-content 1fr", gap: "8px 24px", margin: 0 }}>
          <dt className="tp-muted">שם פרטי</dt>
          <dd>{person.givenName ?? "—"}</dd>
          <dt className="tp-muted">שם משפחה</dt>
          <dd>{person.familyName ?? "—"}</dd>
          <dt className="tp-muted">תאריך לידה</dt>
          <dd className="tp-num">{person.birthDate ? formatDate(person.birthDate) : "—"}</dd>
          <dt className="tp-muted">מקור</dt>
          <dd>{sourceLabel[person.source]}</dd>
          <dt className="tp-muted">תאריך יצירה</dt>
          <dd className="tp-num">{formatDate(toIsoDate(new Date(person.createdAt)))}</dd>
        </dl>
      </Card>

      <ContactPoints person={person} writable={writable} />
      {studio.can("passes.view") && <PassesSection person={person} />}
      <ConsentSection person={person} />
      <RelationshipsSection person={person} writable={writable} />
      {studio.can("people.view") && <DeliveriesSection personId={person.id} />}

      {/* Owner only (people.erase); never one's own record. */}
      {studio.can("people.erase") && writable && person.membershipId !== studio.membership.membershipId && (
        <div>
          <Button variant="ghost-danger" size="sm" onClick={() => setErasing(true)}>
            מחיקת הנתונים
          </Button>
        </div>
      )}
      {erasing && <EraseDialog personId={person.id} name={person.displayName} onClose={() => setErasing(false)} />}
      {inviting && <InvitePersonDialog person={person} onClose={() => setInviting(false)} />}

      {editing && <EditPersonDialog person={person} onClose={() => setEditing(false)} />}
    </>
  );
}

function usePatchPerson(person: PersonDetail) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  const key = usePersonKey(person.id);
  return useMutation({
    mutationKey: [organizationId, "people.patchPerson"],
    mutationFn: (body: Schemas["UpdatePersonRequest"]) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}/people/{personId}", {
          params: { path: { organizationId, personId: person.id }, header: { "If-Match": person.version } },
          body,
        }),
      ),
    onSuccess: (updated) => queryClient.setQueryData(key, updated),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "people"] }),
  });
}

function EditPersonDialog({ person, onClose }: { person: PersonDetail; onClose: () => void }) {
  const update = usePatchPerson(person);
  const [form, setForm] = useState({
    displayName: person.displayName,
    givenName: person.givenName ?? "",
    familyName: person.familyName ?? "",
  });
  const [birthDate, setBirthDate] = useState<IsoDate | null>(person.birthDate ?? null);
  const [submitted, setSubmitted] = useState(false);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [field]: event.target.value });
  const nameError = form.displayName.trim() === "" ? "צריך שם" : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError) return;
    // An empty optional field clears it (null), as the contract allows.
    update.mutate(
      {
        displayName: form.displayName.trim(),
        givenName: form.givenName.trim() || null,
        familyName: form.familyName.trim() || null,
        birthDate,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="עריכת פרטים"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="edit-person" loading={update.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="edit-person" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="שם לתצוגה" required error={submitted ? nameError : undefined}>
          <Input value={form.displayName} onChange={set("displayName")} maxLength={100} />
        </Field>
        <div className="tp-row" style={{ alignItems: "flex-start" }}>
          <Field label="שם פרטי">
            <Input value={form.givenName} onChange={set("givenName")} maxLength={100} />
          </Field>
          <Field label="שם משפחה">
            <Input value={form.familyName} onChange={set("familyName")} maxLength={100} />
          </Field>
        </div>
        <Field label="תאריך לידה">
          <DateInput value={birthDate} onChange={setBirthDate} max={todayIso()} />
        </Field>
        {update.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(update.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

function ContactPoints({ person, writable }: { person: PersonDetail; writable: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const key = usePersonKey(person.id);
  const path = { organizationId, personId: person.id };
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "people"] }),
    ]);
  const onError = (error: unknown) => toast.show({ tone: "danger", icon: "info", message: contactError(error) });

  const makePrimary = useMutation({
    mutationKey: [organizationId, "people.makePrimary"],
    mutationFn: (contact: ContactPoint) =>
      unwrap(
        api.PATCH("/api/v1/organizations/{organizationId}/people/{personId}/contact-points/{contactPointId}", {
          params: { path: { ...path, contactPointId: contact.id }, header: { "If-Match": contact.version } },
          body: { isPrimary: true },
        }),
      ),
    onError,
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationKey: [organizationId, "people.remove"],
    mutationFn: (contact: ContactPoint) =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/people/{personId}/contact-points/{contactPointId}", {
          params: { path: { ...path, contactPointId: contact.id } },
        }),
      ),
    onError,
    onSettled: refresh,
  });

  return (
    <Card as="section" aria-labelledby="contacts" className="tp-stack">
      <h2 id="contacts">פרטי קשר</h2>
      {person.contactPoints.length === 0 ? (
        <p className="tp-muted">אין פרטי קשר.</p>
      ) : (
        <ul className="tp-stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
          {person.contactPoints.map((contact) => (
            <li key={contact.id} className="tp-row" style={{ justifyContent: "space-between" }}>
              <span className="tp-row" style={{ gap: 8 }}>
                <Icon
                  name={contact.type === "phone" ? "phone" : "mail"}
                  label={contact.type === "phone" ? "טלפון" : "מייל"}
                />
                <bdi className="tp-ltr">{contact.type === "phone" ? displayPhone(contact.value) : contact.value}</bdi>
                {contact.isPrimary && <Chip tone="brand">ראשי</Chip>}
                {contact.verified && <Chip tone="success">מאומת</Chip>}
              </span>
              {writable && !contact.verified && (
                <span className="tp-row" style={{ gap: 4 }}>
                  {!contact.isPrimary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => makePrimary.mutate(contact)}
                      aria-label={`הפיכת ${contact.value} לראשי`}
                    >
                      ראשי
                    </Button>
                  )}
                  <Button
                    variant="ghost-danger"
                    size="sm"
                    onClick={() => remove.mutate(contact)}
                    aria-label={`מחיקת ${contact.value}`}
                  >
                    מחיקה
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {writable && <AddContact person={person} onAdded={refresh} />}
    </Card>
  );
}

function AddContact({ person, onAdded }: { person: PersonDetail; onAdded: () => Promise<unknown> }) {
  const api = useApi();
  const { organizationId } = useStudio();
  const [type, setType] = useState<"phone" | "email">("phone");
  const [value, setValue] = useState("");
  const add = useMutation({
    mutationKey: [organizationId, "people.add"],
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/people/{personId}/contact-points", {
          params: { path: { organizationId, personId: person.id } },
          body: { type, value: value.trim(), isPrimary: false },
        }),
      ),
    onSuccess: async () => {
      setValue("");
      await onAdded();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) add.mutate();
  };

  return (
    <form className="tp-stack" onSubmit={submit} noValidate aria-label="הוספת פרט קשר">
      <div className="tp-row" style={{ alignItems: "flex-end" }}>
        <Field label="סוג">
          <Select value={type} onChange={(event) => setType(event.target.value as "phone" | "email")}>
            <option value="phone">טלפון</option>
            <option value="email">מייל</option>
          </Select>
        </Field>
        <Field label={type === "phone" ? "מספר" : "כתובת"} error={add.isError ? contactError(add.error) : undefined}>
          <Input
            type={type === "phone" ? "tel" : "email"}
            dir="ltr"
            className="tp-ltr"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="secondary" icon="plus" loading={add.isPending}>
          הוספה
        </Button>
      </div>
    </form>
  );
}

function contactError(error: unknown): string {
  if (hasCode(error, "contact_point.invalid_phone")) return "מספר הטלפון לא תקין";
  if (hasCode(error, "contact_point.invalid_email")) return "כתובת המייל לא תקינה";
  if (hasCode(error, "contact_point.verified")) return "את מייל ההתחברות אפשר לשנות רק מהחשבון עצמו.";
  return errorMessage(error, "לא הצלחנו לשמור. נסו שוב.");
}

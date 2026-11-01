import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import {
  Banner,
  Button,
  ButtonLink,
  Chip,
  DateInput,
  Dialog,
  Field,
  Input,
  Segmented,
  Select,
  Skeleton,
  TableScroll,
} from "../../shared/design-system";
import { displayPhone, phoneSearchText } from "../../shared/utilities/phones";
import { todayIso, type IsoDate } from "../../shared/utilities/dates";
import { useDebounced } from "../../shared/useDebounced";
import { useStudio } from "../console/studio";
import { TagChips, useTags } from "../tags/tags";
import { personStatus, sourceLabel } from "./labels";

type Person = Schemas["Person"];

/** `/o/:slug/people`: the studio's person records, with or without a login (docs/27 section 4). */
export function PeoplePage() {
  const studio = useStudio();
  const [text, setText] = useState("");
  const query = useDebounced(text.trim(), 300);
  const [status, setStatus] = useState<"current" | "archived">("current");
  const [adding, setAdding] = useState(false);
  // The tag filter lives in the address (?tag=), so the import can link to the batch it tagged (I-8).
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag") ?? "";
  const tags = useTags();
  const people = usePeople(query.length >= 2 ? phoneSearchText(query) : undefined, status, tag || undefined);
  const rows = people.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <header className="tp-row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="tp-eyebrow">ניהול</span>
          <h1>אנשים</h1>
        </div>
        <div className="tp-row" style={{ gap: 8 }}>
          {/* Importing a member list from a file (docs/34, I-1): owners and admins. */}
          {studio.can("people.import") && (
            <ButtonLink to="import" variant="secondary" icon="upload">
              ייבוא מקובץ
            </ButtonLink>
          )}
          {studio.can("people.manage") && (
            <Button icon="plus" onClick={() => setAdding(true)}>
              אדם חדש
            </Button>
          )}
        </div>
      </header>

      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <Input
          search
          type="search"
          aria-label="חיפוש לפי שם, טלפון או מייל"
          placeholder="חיפוש לפי שם, טלפון או מייל"
          value={text}
          onChange={(event) => setText(event.target.value)}
          style={{ maxWidth: 360 }}
        />
        <div className="tp-row" style={{ gap: 8 }}>
          {(tags.data?.length ?? 0) > 0 && (
            <Select
              aria-label="סינון לפי תגית"
              value={tag}
              onChange={(event) => setParams(event.target.value ? { tag: event.target.value } : {}, { replace: true })}
              style={{ width: "auto" }}
            >
              <option value="">כל התגיות</option>
              {tags.data!.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          )}
          <Segmented
            label="אילו אנשים"
            value={status}
            onChange={setStatus}
            options={[
              { value: "current", label: "פעילים" },
              { value: "archived", label: "בארכיון" },
            ]}
          />
        </div>
      </div>

      {people.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(people.error, "לא הצלחנו לטעון את האנשים. נסו שוב.")}
        </Banner>
      ) : !people.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את האנשים…</span>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : rows.length === 0 ? (
        <p className="tp-muted">
          {query.length >= 2 || tag
            ? "לא נמצא אף אחד."
            : status === "archived"
              ? "אין אנשים בארכיון."
              : "עוד אין אנשים בסטודיו."}
        </p>
      ) : (
        <TableScroll label="אנשים">
          <table className="tp-table tp-table--stack">
            <caption className="tp-sr-only">אנשים</caption>
            <thead>
              <tr>
                <th scope="col">שם</th>
                <th scope="col">טלפון</th>
                <th scope="col">מייל</th>
                <th scope="col">מקור</th>
                <th scope="col">תגיות</th>
                <th scope="col">מצב</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {people.hasNextPage && (
        <div>
          <Button variant="secondary" loading={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>
            עוד אנשים
          </Button>
        </div>
      )}

      {adding && <NewPersonDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function PersonRow({ person }: { person: Person }) {
  const status = personStatus[person.status];
  return (
    <tr>
      <td>
        <Link to={person.id}>{person.displayName}</Link>
        {/* Its own line: beside the name, the link sat in running text and needed more than color (axe, #537 O3). */}
        {person.hasLogin && <div className="tp-caption tp-muted">יש חשבון</div>}
      </td>
      <td data-label="טלפון" data-empty={!person.primaryPhone || undefined}>
        {person.primaryPhone ? <bdi className="tp-ltr tp-num">{displayPhone(person.primaryPhone)}</bdi> : "—"}
      </td>
      <td data-label="מייל" data-empty={!person.primaryEmail || undefined}>
        {person.primaryEmail ? <bdi className="tp-ltr">{person.primaryEmail}</bdi> : "—"}
      </td>
      <td data-label="מקור" className="tp-cell-nowrap">{sourceLabel[person.source]}</td>
      <td data-label="תגיות" data-empty={!person.tags?.length || undefined}>
        <TagChips tags={person.tags} />
      </td>
      <td className="tp-table__end">
        <Chip tone={status.tone}>{status.text}</Chip>
      </td>
    </tr>
  );
}

function usePeople(query: string | undefined, status: "current" | "archived", tag: string | undefined) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useInfiniteQuery({
    queryKey: ["studio", organizationId, "people", { query, status, tag }],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people", {
          params: {
            path: { organizationId },
            // Without a status the API returns active and archived together; each tab asks for its own.
            query: {
              query,
              status: status === "archived" ? "archived" : "active",
              tag,
              limit: 50,
              before: pageParam ?? undefined,
            },
          },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore ?? null,
    placeholderData: keepPreviousData,
  });
}

/** A walk-in at the front desk (P-6: a display name and one phone or email). */
function NewPersonDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { organizationId } = useStudio();
  const [form, setForm] = useState({ displayName: "", givenName: "", familyName: "", phone: "", email: "" });
  const [birthDate, setBirthDate] = useState<IsoDate | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [field]: event.target.value });

  const create = useMutation({
    mutationKey: [organizationId, "people.create"],
    mutationFn: (body: Schemas["CreatePersonRequest"]) =>
      unwrap(api.POST("/api/v1/organizations/{organizationId}/people", { params: { path: { organizationId } }, body })),
    onSuccess: async (person) => {
      await queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "people"] });
      void navigate(person.id);
    },
  });

  const nameError = form.displayName.trim() === "" ? "צריך שם" : null;
  const contactError = form.phone.trim() === "" && form.email.trim() === "" ? "צריך טלפון או מייל" : null;
  const phoneError = hasCode(create.error, "contact_point.invalid_phone") ? "מספר הטלפון לא תקין" : null;
  const emailError = hasCode(create.error, "contact_point.invalid_email") ? "כתובת המייל לא תקינה" : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError || contactError) return;
    const optional = (value: string) => value.trim() || undefined;
    create.mutate({
      displayName: form.displayName.trim(),
      givenName: optional(form.givenName),
      familyName: optional(form.familyName),
      birthDate: birthDate ?? undefined,
      phone: optional(form.phone),
      email: optional(form.email),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="אדם חדש"
      description="למשל מי שהגיע לסטודיו בלי האפליקציה. אפשר להזמין לאפליקציה גם מאוחר יותר."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="new-person" loading={create.isPending}>
            שמירה
          </Button>
        </>
      }
    >
      <form id="new-person" className="tp-stack" onSubmit={submit} noValidate>
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
        <Field label="טלפון" error={(submitted && contactError) || phoneError}>
          <Input
            type="tel"
            dir="ltr"
            className="tp-ltr"
            value={form.phone}
            onChange={set("phone")}
            placeholder="050-1234567"
          />
        </Field>
        <Field label="מייל" error={emailError}>
          <Input type="email" dir="ltr" className="tp-ltr" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="תאריך לידה" help="לא חובה. עוזר להבחין בין אנשים עם אותו שם.">
          <DateInput value={birthDate} onChange={setBirthDate} max={todayIso()} />
        </Field>
        {create.isError && !phoneError && !emailError && (
          <Banner tone="danger" icon="info">
            {errorMessage(create.error, "לא הצלחנו לשמור. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

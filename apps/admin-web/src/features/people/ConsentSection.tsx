import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  Button,
  Card,
  Chip,
  Dialog,
  Field,
  Input,
  Select,
  Skeleton,
  useToast,
} from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";

type PersonDetail = Schemas["PersonDetail"];
type Consent = Schemas["Consent"];
type Purpose = Schemas["ConsentPurpose"];
type Channel = Schemas["ConsentChannel"];

const purposes: { value: Purpose; label: string }[] = [
  { value: "reminders", label: "תזכורות" },
  { value: "marketing", label: "עדכונים ומבצעים" },
];
const channels: { value: Channel; label: string }[] = [
  { value: "email", label: "מייל" },
  { value: "push", label: "התראה" },
  { value: "whatsapp", label: "וואטסאפ" },
];
const methodLabel: Record<Consent["method"], string> = {
  self: "בחירה אישית",
  staff_on_behalf: "נרשם על ידי הסטודיו",
  import: "ייבוא",
};

/** The version of the consent wording the studio uses until Kris writes the texts (docs/27 P-4). */
const draftTextVersion = "draft-2026-10-15";

const day = (iso: string) => formatDate(toIsoDate(new Date(iso)));

/**
 * A person's consent (docs/27 section 4.3): the latest choice per purpose and channel, the full history, and
 * recording a choice on their behalf, e.g. from a paper form (consent.manage). Consent rows are append-only.
 */
export function ConsentSection({ person }: { person: PersonDetail }) {
  const studio = useStudio();
  const [history, setHistory] = useState(false);
  const [recording, setRecording] = useState(false);
  const latest = (purpose: Purpose, channel: Channel) =>
    person.consents.find((c) => c.purpose === purpose && c.channel === channel);
  const live = person.status === "active" || person.status === "archived";

  return (
    <Card as="section" aria-labelledby="consent" className="tp-stack">
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <h2 id="consent">הסכמות</h2>
        <div className="tp-row">
          <Button variant="ghost" size="sm" onClick={() => setHistory(true)}>
            היסטוריה
          </Button>
          {live && studio.can("consent.manage") && (
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setRecording(true)}>
              רישום בחירה
            </Button>
          )}
        </div>
      </div>
      <div className="tp-table-wrap">
        <table className="tp-table tp-table--compact">
          <caption className="tp-sr-only">הסכמות לפי מטרה וערוץ</caption>
          <thead>
            <tr>
              <th scope="col">מטרה</th>
              {channels.map((channel) => (
                <th key={channel.value} scope="col">
                  {channel.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {purposes.map((purpose) => (
              <tr key={purpose.value}>
                <th scope="row">{purpose.label}</th>
                {channels.map((channel) => {
                  const consent = latest(purpose.value, channel.value);
                  return (
                    <td key={channel.value}>
                      {!consent ? (
                        <span className="tp-muted">לא נבחר</span>
                      ) : (
                        <Chip
                          tone={consent.state === "granted" ? "success" : "neutral"}
                          title={`${day(consent.occurredAt)} · ${methodLabel[consent.method]}`}
                        >
                          {consent.state === "granted" ? "מאושר" : "בוטל"}
                        </Chip>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history && <HistoryDialog personId={person.id} onClose={() => setHistory(false)} />}
      {recording && <RecordDialog person={person} onClose={() => setRecording(false)} />}
    </Card>
  );
}

function HistoryDialog({ personId, onClose }: { personId: string; onClose: () => void }) {
  const api = useApi();
  const { organizationId } = useStudio();
  const history = useQuery({
    queryKey: ["studio", organizationId, "person", personId, "consents"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people/{personId}/consents", {
          params: { path: { organizationId, personId } },
        }),
      ),
  });
  const purpose = (value: Purpose) => purposes.find((p) => p.value === value)?.label ?? value;
  const channel = (value: Channel) => channels.find((c) => c.value === value)?.label ?? value;

  return (
    <Dialog
      open
      onClose={onClose}
      title="היסטוריית הסכמות"
      description="כל בחירה נשמרת. בחירה חדשה לא מוחקת את הקודמת."
      actions={<Button onClick={onClose}>סגירה</Button>}
    >
      {history.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(history.error, "לא הצלחנו לטעון את ההיסטוריה.")}
        </Banner>
      ) : !history.data ? (
        <Skeleton height={120} />
      ) : history.data.items.length === 0 ? (
        <p className="tp-muted">עוד לא נרשמה אף בחירה.</p>
      ) : (
        <ul
          className="tp-stack"
          style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}
          aria-label="הבחירות, מהחדשה לישנה"
        >
          {history.data.items.map((consent) => (
            <li key={consent.id} className="tp-row" style={{ justifyContent: "space-between" }}>
              <span>
                {purpose(consent.purpose)} · {channel(consent.channel)}:{" "}
                <strong>{consent.state === "granted" ? "מאושר" : "בוטל"}</strong>
              </span>
              <span className="tp-caption tp-muted">
                {day(consent.occurredAt)} · {methodLabel[consent.method]} ·{" "}
                <bdi className="tp-ltr">{consent.textVersion}</bdi>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function RecordDialog({ person, onClose }: { person: PersonDetail; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { organizationId } = useStudio();
  const [purpose, setPurpose] = useState<Purpose>("reminders");
  const [channel, setChannel] = useState<Channel>("email");
  const [state, setState] = useState<"granted" | "withdrawn">("granted");
  const [textVersion, setTextVersion] = useState(draftTextVersion);
  const record = useMutation({
    mutationKey: [organizationId, "people.record"],
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/people/{personId}/consents", {
          params: { path: { organizationId, personId: person.id } },
          body: { purpose, channel, state, textVersion: textVersion.trim() },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "person", person.id] });
      toast.show({ tone: "success", icon: "check", message: "הבחירה נרשמה" });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (textVersion.trim()) record.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="רישום בחירה"
      description={`בחירה של ${person.displayName}, למשל מטופס שמילאו בסטודיו. היא נשמרת כרישום של הסטודיו.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="record-consent" loading={record.isPending}>
            רישום
          </Button>
        </>
      }
    >
      <form id="record-consent" className="tp-stack" onSubmit={submit} noValidate>
        <Field label="מטרה">
          <Select value={purpose} onChange={(event) => setPurpose(event.target.value as Purpose)}>
            {purposes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ערוץ">
          <Select value={channel} onChange={(event) => setChannel(event.target.value as Channel)}>
            {channels.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="הבחירה">
          <Select value={state} onChange={(event) => setState(event.target.value as "granted" | "withdrawn")}>
            <option value="granted">מאושר</option>
            <option value="withdrawn">לא מאושר (או ביטול)</option>
          </Select>
        </Field>
        <Field label="גרסת הנוסח" help="הגרסה של הנוסח שהאדם ראה." error={textVersion.trim() ? undefined : "צריך גרסה"}>
          <Input
            dir="ltr"
            className="tp-ltr"
            value={textVersion}
            onChange={(event) => setTextVersion(event.target.value)}
            maxLength={40}
          />
        </Field>
        {record.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(record.error, "לא הצלחנו לרשום. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

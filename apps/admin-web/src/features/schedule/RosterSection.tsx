import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import {
  Avatar,
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Tabs,
  useToast,
} from "../../shared/design-system";
import { formatDate, todayIn } from "../../shared/utilities/dates";
import { phoneSearchText } from "../../shared/utilities/phones";
import { clockTime } from "../../shared/utilities/times";
import { useStudio } from "../console/studio";
import { scheduleKeys, useBookingPolicy, useStudioTimeZone, type Session } from "./queries";

type RosterEntry = Schemas["RosterEntry"];
type Booking = Schemas["Booking"];

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

function useRoster(sessionId: string) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: [...scheduleKeys.session(organizationId, sessionId), "roster"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/sessions/{sessionId}/roster", {
          params: { path: { organizationId, sessionId } },
        }),
      ),
  });
}

function useRefreshSchedule() {
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return () => queryClient.invalidateQueries({ queryKey: scheduleKeys.all(organizationId) });
}

/**
 * Booked and waiting people, attendance and cancellations (ClassDetail mockup, docs/29 section 6.4). A list, not a
 * table, so the instructor can mark attendance from a phone at the door.
 */
export function RosterSection({ session }: { session: Session }) {
  const studio = useStudio();
  const timeZone = useStudioTimeZone();
  const roster = useRoster(session.id);
  const [tab, setTab] = useState<"booked" | "waitlisted">("booked");
  const [cancelling, setCancelling] = useState<RosterEntry | null>(null);
  const [adding, setAdding] = useState(false);
  // When the page opened; the API has the last word on every window.
  const [now] = useState(() => Date.now());
  const starts = new Date(session.startsAt).getTime();
  const ends = new Date(session.endsAt).getTime();
  const scheduled = session.status === "scheduled";
  const instructor = session.instructor?.membershipId === studio.membership.membershipId;
  const manage = studio.can("bookings.manage") && scheduled;
  const markable =
    (studio.can("attendance.mark") || instructor) &&
    scheduled &&
    now >= starts - 30 * minute &&
    now <= starts + 7 * day;

  if (roster.isError) {
    return (
      <Card as="section" aria-labelledby="roster" className="tp-stack">
        <h2 id="roster">משתתפים</h2>
        <Banner tone="danger" icon="info">
          {hasCode(roster.error, "permission.denied")
            ? "רשימת המשתתפים פתוחה לצוות ולמדריך.ה של השיעור."
            : errorMessage(roster.error, "לא הצלחנו לטעון את רשימת המשתתפים. נסו שוב.")}
        </Banner>
      </Card>
    );
  }

  const booked = roster.data?.booked ?? [];
  const waiting = roster.data?.waitlisted ?? [];
  const list = tab === "booked" ? booked : waiting;

  return (
    <Card as="section" aria-labelledby="roster" className="tp-stack">
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <h2 id="roster">משתתפים</h2>
        {manage && now < ends && (
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setAdding(true)}>
            רישום מתאמן.ת
          </Button>
        )}
      </div>
      {!roster.data ? (
        <div aria-busy="true">
          <span className="tp-sr-only">טוענים את רשימת המשתתפים…</span>
          <Skeleton height={56} />
        </div>
      ) : (
        <Tabs
          label="משתתפים"
          value={tab}
          onChange={setTab}
          block
          tabs={[
            { value: "booked", label: `רשומים · ${booked.length}` },
            { value: "waitlisted", label: `רשימת המתנה · ${waiting.length}` },
          ]}
        >
          {list.length === 0 ? (
            <EmptyState
              icon={tab === "booked" ? "users" : "clock"}
              title={tab === "booked" ? "עוד אין רשומים." : "רשימת ההמתנה ריקה"}
              titleAs="p"
            >
              {tab === "waitlisted" ? "כשהשיעור מתמלא, מי שמנסה להירשם נכנס לכאן לפי הסדר." : undefined}
            </EmptyState>
          ) : (
            <ul className="tp-stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 12 }}>
              {list.map((entry) => (
                <RosterRow
                  key={entry.bookingId}
                  entry={entry}
                  timeZone={timeZone}
                  markable={markable && tab === "booked"}
                  onCancel={manage && now < ends ? () => setCancelling(entry) : undefined}
                />
              ))}
            </ul>
          )}
        </Tabs>
      )}
      {tab === "waitlisted" && waiting.length > 0 && (
        <p className="tp-caption tp-muted">כשמקום מתפנה, הממתין.ה הראשון.ה מקבל.ת אותו אוטומטית והודעה באפליקציה.</p>
      )}
      {cancelling && (
        <CancelBookingDialog entry={cancelling} session={session} now={now} onClose={() => setCancelling(null)} />
      )}
      {adding && <AddBookingDialog session={session} onClose={() => setAdding(false)} />}
    </Card>
  );
}

interface RosterRowProps {
  entry: RosterEntry;
  timeZone: string;
  markable: boolean;
  onCancel?: () => void;
}

function RosterRow({ entry, timeZone, markable, onCancel }: RosterRowProps) {
  const studio = useStudio();
  const name = entry.person.displayName;
  const bookedAt = new Date(entry.bookedAt);
  const when = `${formatDate(todayIn(timeZone, bookedAt)).slice(0, 5)} · ${clockTime(bookedAt, timeZone)}`;
  return (
    <li className="tp-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
      <span className="tp-row" style={{ gap: 10, minWidth: 0 }}>
        {entry.waitlistPosition != null && entry.status === "waitlisted" && (
          <span className="tp-num" aria-label={`מקום ${entry.waitlistPosition} בהמתנה`}>
            {entry.waitlistPosition}
          </span>
        )}
        <Avatar name={name} size="sm" />
        <span className="tp-stack" style={{ gap: 2, minWidth: 0 }}>
          {studio.can("people.view") ? (
            <Link to={`/o/${studio.slug}/people/${entry.person.id}`}>{name}</Link>
          ) : (
            <strong>{name}</strong>
          )}
          <span className="tp-caption tp-muted tp-num">
            {entry.status === "waitlisted" ? "נכנס.ה להמתנה ב־" : "נרשם.ה ב־"}
            {when}
          </span>
        </span>
        {entry.passName && <Chip tone="neutral">{entry.passName}</Chip>}
      </span>
      <span className="tp-row" style={{ gap: 8 }}>
        {markable ? (
          <AttendanceToggle entry={entry} />
        ) : (
          entry.status !== "booked" &&
          entry.status !== "waitlisted" && (
            <Chip tone={entry.status === "attended" ? "success" : "danger"}>
              {entry.status === "attended" ? "הגיע.ה" : "לא הגיע.ה"}
            </Chip>
          )
        )}
        {onCancel && (
          <Button
            variant="ghost-danger"
            size="sm"
            onClick={onCancel}
            aria-label={entry.status === "waitlisted" ? `הסרת ${name} מההמתנה` : `ביטול ההרשמה של ${name}`}
          >
            {entry.status === "waitlisted" ? "הסרה" : "ביטול"}
          </Button>
        )}
      </span>
    </li>
  );
}

/** Two pressed-state buttons, "הגיע.ה" and "לא הגיע.ה"; each press saves at once. */
function AttendanceToggle({ entry }: { entry: RosterEntry }) {
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshSchedule();
  const { organizationId } = useStudio();
  const mark = useMutation({
    mutationFn: (state: "attended" | "no_show") =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/bookings/{bookingId}/attendance", {
          params: { path: { organizationId, bookingId: entry.bookingId } },
          body: { state },
        }),
      ),
    onSuccess: refresh,
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
  });
  // The pending choice shows at once.
  const state = mark.isPending ? mark.variables : entry.status;
  return (
    <div role="group" aria-label={`נוכחות של ${entry.person.displayName}`} className="tp-seg">
      {(
        [
          ["attended", "הגיע.ה"],
          ["no_show", "לא הגיע.ה"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="tp-seg__opt"
          aria-pressed={state === value}
          disabled={mark.isPending}
          onClick={() => state !== value && mark.mutate(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface CancelBookingDialogProps {
  entry: RosterEntry;
  session: Session;
  now: number;
  onClose: () => void;
}

function CancelBookingDialog({ entry, session, now, onClose }: CancelBookingDialogProps) {
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshSchedule();
  const { organizationId } = useStudio();
  const policy = useBookingPolicy();
  const [returnEntry, setReturnEntry] = useState(false);
  const waiting = entry.status === "waitlisted";
  const name = entry.person.displayName;
  const freeUntil = policy.data
    ? new Date(session.startsAt).getTime() - policy.data.freeCancelHours * hour
    : Number.POSITIVE_INFINITY;
  const late = !waiting && entry.passName != null && now > freeUntil;

  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/bookings/{bookingId}/cancel", {
          params: { path: { organizationId, bookingId: entry.bookingId } },
          body: late && returnEntry ? { returnEntry: true } : {},
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast.show({
        tone: "success",
        icon: "check",
        message: waiting ? `${name} הוסר.ה מרשימת ההמתנה` : `ההרשמה של ${name} בוטלה`,
      });
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={waiting ? `להסיר את ${name} מההמתנה?` : `לבטל את ההרשמה של ${name}?`}
      description={
        waiting
          ? undefined
          : late
            ? `עבר חלון הביטול החינמי (${policy.data?.freeCancelHours} שעות לפני השיעור), ולכן הכניסה נחשבת מנוצלת.`
            : "הכניסה תחזור לכרטיסייה. אם יש ממתינים, הראשון.ה בתור יקבל.ת את המקום."
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            השארה
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            {waiting ? "הסרה מההמתנה" : "ביטול ההרשמה"}
          </Button>
        </>
      }
    >
      {late && (
        <Checkbox
          label="להחזיר את הכניסה בכל זאת"
          checked={returnEntry}
          onChange={(event) => setReturnEntry(event.target.checked)}
        />
      )}
      {cancel.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(cancel.error, "לא הצלחנו לבטל. נסו שוב.")}
        </Banner>
      )}
    </Dialog>
  );
}

function AddBookingDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshSchedule();
  const { organizationId } = useStudio();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ id: string; displayName: string } | null>(null);
  const query = text.trim();
  const found = useQuery({
    queryKey: ["studio", organizationId, "people", { query, status: "active", picker: true }],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people", {
          params: { path: { organizationId }, query: { query: phoneSearchText(query), status: "active", limit: 8 } },
        }),
      ),
    enabled: query.length >= 2 && !picked,
  });

  const book = useMutation({
    mutationFn: (personId: string) =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/sessions/{sessionId}/bookings", {
          params: { path: { organizationId, sessionId: session.id } },
          body: { personId },
        }),
      ),
    onSuccess: async (booking: Booking) => {
      await refresh();
      toast.show({
        tone: "success",
        icon: "check",
        message:
          booking.status === "waitlisted"
            ? `השיעור מלא: ${booking.person.displayName} ברשימת ההמתנה, במקום ${booking.waitlistPosition ?? ""}`
            : `${booking.person.displayName} נרשם.ה לשיעור`,
      });
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (picked) book.mutate(picked.id);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="רישום מתאמן.ת לשיעור"
      description="נלקחת כניסה מהכרטיסייה או המנוי שלהם. כשהשיעור מלא, הם נכנסים לרשימת ההמתנה."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="add-booking" loading={book.isPending} disabled={!picked}>
            רישום
          </Button>
        </>
      }
    >
      <form id="add-booking" className="tp-stack" onSubmit={submit} noValidate>
        {picked ? (
          <div className="tp-row" style={{ justifyContent: "space-between" }}>
            <strong>{picked.displayName}</strong>
            <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
              החלפה
            </Button>
          </div>
        ) : (
          <>
            <Field label="חיפוש אדם" help="לפי שם, טלפון או מייל">
              <Input type="search" value={text} onChange={(event) => setText(event.target.value)} />
            </Field>
            {query.length >= 2 &&
              (found.data && found.data.items.length > 0 ? (
                <ul
                  aria-label="תוצאות"
                  className="tp-stack"
                  style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}
                >
                  {found.data.items.map((candidate) => (
                    <li key={candidate.id}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPicked({ id: candidate.id, displayName: candidate.displayName })}
                      >
                        {candidate.displayName}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tp-muted">{found.isFetching ? "מחפשים…" : "לא נמצא אף אחד"}</p>
              ))}
          </>
        )}
        {book.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(book.error, "לא הצלחנו לרשום. נסו שוב.")}
          </Banner>
        )}
      </form>
    </Dialog>
  );
}

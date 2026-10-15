import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { TempoApiError } from "@tempo/api-client";
import { errorMessage } from "../../api/errors";
import {
  Avatar,
  Banner,
  Button,
  ButtonLink,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Skeleton,
  shortDate,
  type ChipTone,
} from "../../shared/design-system";
import type { IsoDate } from "../../shared/utilities/dates";
import { BookingSheet, useBookingFlow } from "./BookingSheet";
import {
  categoryName,
  freeCancelDeadline,
  freeSpots,
  myState,
  spotsText,
  waitlistOpen,
  waitText,
  type MyState,
} from "./bookingState";
import { relativeDay } from "./format";
import styles from "./member.module.css";
import {
  useBookingPolicy,
  useCancelBooking,
  useInbox,
  useSession,
  useStudio,
  useStudioClock,
  type Booking,
  type BookingPolicy,
  type Session,
  type Studio,
} from "./studio";
import { LoadError, NoStudio } from "./StudioGate";
import { clockTime, hasStarted, momentText } from "./studioTime";

export function ClassScreen() {
  const studio = useStudio();
  const { sessionId = "" } = useParams();
  return studio ? <StudioClass studio={studio} sessionId={sessionId} /> : <NoStudio title="פרטי שיעור" />;
}

const stateChips: Partial<Record<MyState, { label: string; tone: ChipTone }>> = {
  booked: { label: "נרשמת", tone: "success" },
  attended: { label: "הגעת", tone: "success" },
  no_show: { label: "לא הגעת", tone: "warning" },
  expired: { label: "לא התפנה מקום", tone: "neutral" },
};

function StudioClass({ studio, sessionId }: { studio: Studio; sessionId: string }) {
  const { timeZone, now, today } = useStudioClock(studio.id);
  const session = useSession(studio.id, sessionId);
  const policy = useBookingPolicy(studio.id);
  const flow = useBookingFlow(studio.id);
  const cancel = useCancelBooking(studio.id);
  const navigate = useNavigate();
  const location = useLocation();
  const [booking, setBooking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelled, setCancelled] = useState<{ booking: Booking; waited: boolean } | null>(null);
  const inbox = useInbox(studio.id);

  // Back to wherever the member came from; a link opened straight on this screen goes to the timetable.
  const back = () => (location.key === "default" ? navigate("/book") : navigate(-1));
  const header = (
    <div className={styles.header}>
      <IconButton icon="chevron-right" label="חזרה" onClick={back} />
    </div>
  );

  if (session.isPending) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy="true">
        {header}
        <Skeleton height={80} />
        <Skeleton height={160} />
      </main>
    );
  }
  if (session.isError) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
        {header}
        {session.error instanceof TempoApiError && session.error.status === 404 ? (
          <EmptyState
            icon="calendar"
            title="השיעור לא נמצא"
            action={
              <ButtonLink to="/book" variant="secondary">
                למערכת השיעורים
              </ButtonLink>
            }
          >
            ייתכן שהוסר מהמערכת.
          </EmptyState>
        ) : (
          <LoadError error={session.error} onRetry={() => void session.refetch()} />
        )}
      </main>
    );
  }

  const item = session.data;
  const state = myState(item, now);
  const started = hasStarted(item.startsAt, now);
  const chip =
    item.status === "cancelled"
      ? { label: "השיעור בוטל", tone: "neutral" as const }
      : state === "waitlisted"
        ? { label: waitText(item.myBooking?.waitlistPosition), tone: "warning" as const }
        : stateChips[state];
  const deadline = freeCancelDeadline(item, policy.data);
  const inFreeWindow = deadline !== null && now.getTime() <= deadline.getTime();
  const deadlineText = deadline ? momentText(deadline, timeZone, today) : null;
  const open = item.status === "scheduled" && state === "none" && !started;
  const canBook = open && freeSpots(item) > 0;
  const canWait = open && freeSpots(item) === 0 && waitlistOpen(item, policy.data, now);
  const waitUntil = new Date(new Date(item.startsAt).getTime() - (policy.data?.waitlistCutoffHours ?? 2) * 3_600_000);
  // The inbox says which bookings came off the waitlist (docs/29 section 6.3).
  const promoted =
    state === "booked" &&
    (inbox.data?.items ?? []).some(
      (notice) => notice.kind === "booking.promoted" && notice.data.bookingId === item.myBooking?.bookingId,
    );

  function confirmCancel() {
    const bookingId = item.myBooking?.bookingId;
    if (!bookingId) return;
    const waited = state === "waitlisted";
    cancel.mutate(bookingId, {
      onSuccess: (result) => {
        setConfirming(false);
        setCancelled({ booking: result, waited });
      },
      onError: () => setConfirming(false),
    });
  }

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
      {header}

      <div className={styles.heading}>
        <div className={styles.chips}>
          <Chip tone={`cat-${item.classType.color}`}>{categoryName(item.classType.category, [item])}</Chip>
          {chip && (
            <Chip tone={chip.tone} plain={chip.tone === "neutral"}>
              {chip.label}
            </Chip>
          )}
        </div>
        <h1 className={styles.title}>{item.classType.name}</h1>
        <span className="tp-muted">{whenText(item, timeZone, today)}</span>
      </div>

      {cancelled && (
        <Banner tone="info" icon="info">
          {cancelled.waited ? "יצאת מרשימת ההמתנה." : cancelledText(cancelled.booking)}
        </Banner>
      )}
      {cancel.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(cancel.error, "הביטול לא הצליח. נסו שוב.")}
        </Banner>
      )}
      {promoted && (
        <Banner tone="success" icon="check">
          התפנה מקום, ונרשמת אוטומטית מרשימת ההמתנה.
        </Banner>
      )}
      {state === "waitlisted" && (
        <Banner tone="info" icon="clock">
          {waitText(item.myBooking?.waitlistPosition)}. אם יתפנה מקום עד {momentText(waitUntil, timeZone, today)}, נרשום
          אותך אוטומטית, תנוצל כניסה ונודיע לך כאן.
        </Banner>
      )}
      {item.status === "cancelled" && (
        <Banner tone="warning" icon="info">
          הסטודיו ביטל את השיעור הזה. אם נרשמת, הכניסה חזרה אליך.
        </Banner>
      )}

      <Card as="section" className={styles.classCard} aria-label="פרטי השיעור">
        {item.instructor && (
          <div className={styles.sheetDetail}>
            <Avatar name={item.instructor.displayName} />
            <span className={styles.studioName}>{item.instructor.displayName}</span>
          </div>
        )}
        {item.room && (
          <div className={styles.sheetDetail}>
            <span className="tp-icon-tile tp-icon-tile--sm">
              <Icon name="map-pin" />
            </span>
            <span>{item.room.name}</span>
          </div>
        )}
        {item.status === "scheduled" && !started && (
          <div className={styles.sheetDetail}>
            <span className="tp-icon-tile tp-icon-tile--sm">
              <Icon name="clock" />
            </span>
            <span>{cancelWindowText(state, deadlineText, inFreeWindow, policy.data)}</span>
          </div>
        )}
      </Card>

      {item.status === "scheduled" && (
        <Card as="section" small tone="cream" className={styles.sheetDetail} aria-label="מקומות">
          <span className="tp-icon-tile tp-icon-tile--sm">
            <Icon name="user" />
          </span>
          <span>
            {item.bookedCount} מתוך {item.capacity} רשומים · {spotsText(item)}
            {open && freeSpots(item) === 0 && !canWait && " · רשימת ההמתנה סגורה"}
          </span>
        </Card>
      )}

      <div className={styles.sheetActions}>
        {state === "booked" && !started && item.status === "scheduled" && (
          <Button variant="ghost-danger" size="lg" block onClick={() => setConfirming(true)}>
            ביטול הרשמה
          </Button>
        )}
        {state === "waitlisted" && (
          <Button variant="ghost-danger" size="lg" block onClick={() => setConfirming(true)}>
            יציאה מרשימת ההמתנה
          </Button>
        )}
        {(canBook || canWait) && (
          <Button size="lg" block loading={flow.pendingId === item.id} onClick={() => setBooking(true)}>
            {canBook ? "הרשמה לשיעור" : "הצטרפות לרשימת ההמתנה"}
          </Button>
        )}
        {state === "none" && !canBook && !canWait && (
          <ButtonLink to={`/book?day=${item.localDate}`} variant="secondary" block>
            לשיעורים אחרים
          </ButtonLink>
        )}
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={state === "waitlisted" ? "לצאת מרשימת ההמתנה?" : "לבטל את ההרשמה?"}
        description={
          state === "waitlisted"
            ? "המקום שלך בתור יעבור למי שאחריך. בהמתנה לא נוצלה כניסה, אז אין מה להחזיר."
            : inFreeWindow
              ? `עדיין בזמן הביטול החינמי (עד ${deadlineText}), כך שהכניסה תחזור אליך. המקום יעבור למי שממתין.`
              : deadlineText
                ? `עבר זמן הביטול החינמי (${deadlineText}). אם תבטלו עכשיו, הכניסה לא תחזור.`
                : "אם עבר זמן הביטול החינמי, הכניסה לא תחזור."
        }
      >
        <div className={styles.sheetActions}>
          <Button variant="danger" size="lg" block loading={cancel.isPending} onClick={confirmCancel}>
            {state === "waitlisted" ? "יציאה מההמתנה" : inFreeWindow ? "ביטול ההרשמה" : "ביטול מאוחר"}
          </Button>
          <Button variant="ghost" block disabled={cancel.isPending} onClick={() => setConfirming(false)}>
            {state === "waitlisted" ? "להישאר בהמתנה" : "השארת ההרשמה"}
          </Button>
        </div>
      </Dialog>

      <BookingSheet
        session={booking ? item : null}
        timeZone={timeZone}
        today={today}
        policy={policy.data}
        now={now}
        pending={flow.pendingId !== undefined}
        onConfirm={(target) => flow.run(target, () => setBooking(false))}
        onClose={() => setBooking(false)}
      />
    </main>
  );
}

/** "היום 13.10 · 17:30 עד 18:20". */
function whenText(session: Session, timeZone: string, today: IsoDate): string {
  return `${relativeDay(session.localDate, today)} ${shortDate(session.localDate)} · ${clockTime(session.startsAt, timeZone)} עד ${clockTime(session.endsAt, timeZone)}`;
}

function cancelWindowText(
  state: MyState,
  deadlineText: string | null,
  inFreeWindow: boolean,
  policy: BookingPolicy | undefined,
): string {
  if (state === "booked" && deadlineText) {
    return inFreeWindow ? `ביטול חינם עד ${deadlineText}` : "עבר זמן הביטול החינמי: ביטול עכשיו לא יחזיר את הכניסה";
  }
  if (!policy) return "ביטול חינם עד זמן קצוב לפני השיעור";
  return policy.freeCancelHours === 0
    ? "ביטול חינם עד תחילת השיעור"
    : `ביטול חינם עד ${policy.freeCancelHours === 1 ? "שעה" : `${policy.freeCancelHours} שעות`} לפני השיעור`;
}

function cancelledText(booking: Booking): string {
  return booking.lateCancel
    ? "ההרשמה בוטלה. זה ביטול מאוחר, ולכן הכניסה נוצלה."
    : "ההרשמה בוטלה בזמן, והכניסה חזרה אליך.";
}

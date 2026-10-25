import { useEffect, useRef, useState } from "react";
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
import { saveFile } from "../../shared/utilities/saveFile";
import { BookedDialog } from "./BookedDialog";
import { BookingSheet, useBookingFlow } from "./BookingSheet";
import {
  categoryName,
  deviceCountText,
  freeCancelDeadline,
  freeSpots,
  myState,
  spotsText,
  waitlistCutoff,
  waitlistOpen,
  waitText,
  type MyState,
} from "./bookingState";
import { relativeDay } from "./format";
import styles from "./member.module.css";
import {
  useBookingPolicy,
  useCalendarFile,
  useCancelBooking,
  useChangeSpot,
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
import { useInstructors, useSessionSpots, useUsualSpot, type Instructor, type SessionSpot } from "./experience";
import { RoomMap } from "./RoomMap";
import { CheckinPass } from "./Premium";
import { useBookingPaused } from "./StudioNotices";
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
  const sessionQuery = useSession(studio.id, sessionId);
  const policy = useBookingPolicy(studio.id);
  const flow = useBookingFlow(studio.id);
  const paused = useBookingPaused();
  const cancel = useCancelBooking(studio.id);
  const calendar = useCalendarFile(studio.id);
  const navigate = useNavigate();
  const location = useLocation();
  // `?book=1` comes from the class's public page (docs/37 section 4.3): the booking sheet opens on arrival.
  const [sheetOpen, setSheetOpen] = useState(() => new URLSearchParams(location.search).get("book") === "1");
  const [confirming, setConfirming] = useState(false);
  const [cancelled, setCancelled] = useState<{ booking: Booking; waited: boolean } | null>(null);
  const [booked, setBooked] = useState<Booking | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [passOpen, setPassOpen] = useState(false);
  const inbox = useInbox(studio.id);
  const instructors = useInstructors(studio.id);
  const changeSpot = useChangeSpot(studio.id);
  const usualSpot = useUsualSpot(studio.id);
  const withSpots = sessionQuery.data?.room?.spotSelection === true;
  const spots = useSessionSpots(studio.id, sessionId, withSpots);
  // After booking or cancelling, the button that was pressed is gone: focus moves to the class's title, and the
  // result banner under it is announced.
  const title = useRef<HTMLHeadingElement>(null);
  const [focusTitle, setFocusTitle] = useState(0);
  useEffect(() => {
    if (focusTitle > 0) title.current?.focus();
  }, [focusTitle]);

  // Back to wherever the member came from; a link opened straight on this screen goes to the timetable.
  const back = () => (location.key === "default" ? navigate("/book") : navigate(-1));
  const header = (
    <div className={styles.header}>
      <IconButton icon="chevron-right" label="חזרה" onClick={back} />
    </div>
  );

  if (sessionQuery.isPending) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy="true">
        {header}
        <Skeleton height={80} />
        <Skeleton height={160} />
      </main>
    );
  }
  if (sessionQuery.isError) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
        {header}
        {sessionQuery.error instanceof TempoApiError && sessionQuery.error.status === 404 ? (
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
          <LoadError error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />
        )}
      </main>
    );
  }

  const session = sessionQuery.data;
  const state = myState(session, now);
  const map = spots.data?.spotSelection ? spots.data : null;
  const mySpot = map?.spots.find((spot) => spot.state === "mine") ?? null;
  const usualFree = map?.spots.find((spot) => spot.id === map.usualSpotId && spot.state === "free") ?? null;
  const chosenSpot =
    map?.spots.find((spot) => spot.id === (chosen ?? (state === "none" ? usualFree?.id : mySpot?.id))) ?? null;
  const instructor: Instructor | undefined = session.instructor
    ? instructors.data?.get(session.instructor.membershipId)
    : undefined;
  const started = hasStarted(session.startsAt, now);
  const chip =
    session.status === "cancelled"
      ? { label: "השיעור בוטל", tone: "neutral" as const }
      : state === "waitlisted"
        ? { label: waitText(session.myBooking?.waitlistPosition), tone: "warning" as const }
        : stateChips[state];
  const deadline = freeCancelDeadline(session, policy.data);
  const inFreeWindow = deadline !== null && now.getTime() <= deadline.getTime();
  const deadlineText = deadline ? momentText(deadline, timeZone, today) : null;
  const open = session.status === "scheduled" && state === "none" && !started;
  const canBook = open && freeSpots(session) > 0;
  const canWait = open && freeSpots(session) === 0 && waitlistOpen(session, policy.data, now);
  const waitUntil = waitlistCutoff(session, policy.data);
  // The inbox says which bookings came off the waitlist (docs/29 section 6.3).
  const promoted =
    state === "booked" &&
    (inbox.data?.items ?? []).some(
      (notice) => notice.kind === "booking.promoted" && notice.data.bookingId === session.myBooking?.bookingId,
    );

  function confirmCancel() {
    const bookingId = session.myBooking?.bookingId;
    if (!bookingId) return;
    const waited = state === "waitlisted";
    cancel.mutate(bookingId, {
      onSuccess: (result) => {
        setConfirming(false);
        setCancelled({ booking: result, waited });
        setFocusTitle((count) => count + 1);
      },
      onError: () => setConfirming(false),
    });
  }

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
      {header}

      <section className={`tp-hero ${styles.classHero}`} aria-labelledby="class-title">
        {session.classType.coverUrl && <img className="tp-hero__photo" src={session.classType.coverUrl} alt="" />}
        <div className="tp-hero__top">
          <Chip tone="neutral" plain className="tp-glass-dark">
            {categoryName(session.classType.category, [session])}
          </Chip>
          {chip && (
            <Chip tone={chip.tone} plain={chip.tone === "neutral"} className="tp-glass-dark">
              {chip.label}
            </Chip>
          )}
        </div>
        <div className="tp-hero__body">
          <div className="tp-hero__text">
            <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.92 }}>{whenText(session, timeZone, today)}</span>
            <h1 id="class-title" ref={title} tabIndex={-1} className="tp-hero__title">
              <bdi>{session.classType.name}</bdi>
            </h1>
            {session.instructor && (
              <span className="tp-hero__meta">
                <Avatar name={session.instructor.displayName} src={instructor?.photoSmallUrl ?? undefined} size="sm" />
                <span>
                  עם <bdi>{session.instructor.displayName}</bdi>
                  {session.room && <> · {session.room.name}</>}
                </span>
              </span>
            )}
          </div>
        </div>
      </section>

      {cancelled && (
        <Banner tone="info" icon="info">
          {cancelled.waited ? "יצאת מרשימת ההמתנה." : cancelledText(cancelled.booking)}
        </Banner>
      )}
      {calendar.isError && (
        <Banner tone="danger" icon="info">
          {calendar.error instanceof TempoApiError && calendar.error.status === 404
            ? "ההרשמה הזו כבר לא פעילה, ולכן אין מה להוסיף ליומן."
            : errorMessage(calendar.error, "לא הצלחנו להכין את קובץ היומן. נסו שוב.")}
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
          {waitText(session.myBooking?.waitlistPosition)}. אם יתפנה מקום עד {momentText(waitUntil, timeZone, today)},
          נרשום אותך אוטומטית, תנוצל כניסה ונודיע לך כאן.
        </Banner>
      )}
      {session.status === "cancelled" && (
        <Banner tone="warning" icon="info">
          הסטודיו ביטל את השיעור הזה. אם נרשמת, הכניסה חזרה אליך.
        </Banner>
      )}

      {session.memberNote && (
        <Card as="section" small className={styles.note} aria-label="הערה מהמדריכה">
          <span className="tp-eyebrow">
            {session.instructor ? <bdi>{session.instructor.displayName}</bdi> : "מהמדריכה"}
          </span>
          <p>{session.memberNote}</p>
        </Card>
      )}

      {map &&
        // A full class offers the waitlist, not a device (#503).
        (state === "booked" || (state === "none" && canBook)) &&
        session.status === "scheduled" &&
        !started && (
          <section aria-labelledby="room-title" className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 id="room-title" className={styles.sectionTitle}>
                {state === "booked" ? "המכשיר שלך" : "בחירת מכשיר"}
              </h2>
              <span className="tp-caption">{deviceCountText(session, map.spots)}</span>
            </div>
            <RoomMap
              map={map}
              selectedId={chosenSpot?.id ?? null}
              onSelect={(spot: SessionSpot) => setChosen(spot.id)}
              instructorName={session.instructor?.displayName}
              instructorPhoto={instructor?.photoSmallUrl}
            />
            {state === "booked" && chosenSpot && mySpot && chosenSpot.id !== mySpot.id && (
              <Button
                size="lg"
                block
                loading={changeSpot.isPending}
                onClick={() => {
                  const bookingId = session.myBooking?.bookingId;
                  if (bookingId)
                    changeSpot.mutate({ bookingId, spotId: chosenSpot.id }, { onSuccess: () => setChosen(null) });
                }}
              >
                מעבר למכשיר {chosenSpot.label}
              </Button>
            )}
            {state === "booked" && mySpot && map.usualSpotId !== mySpot.id && (
              <Button
                variant="ghost"
                block
                loading={usualSpot.isPending}
                onClick={() => session.room && usualSpot.mutate({ roomId: session.room.id, spotId: mySpot.id })}
              >
                לשמור את מכשיר {mySpot.label} כמקום הקבוע שלי
              </Button>
            )}
          </section>
        )}

      {instructor &&
        (instructor.headline || instructor.bio || instructor.instagramHandle || instructor.playlistUrl) && (
          <Card as="section" className={styles.instructor} aria-labelledby="instructor-title">
            <div className={styles.instructorHead}>
              <Avatar name={instructor.displayName} src={instructor.photoSmallUrl ?? undefined} size="lg" />
              <span>
                <h2 id="instructor-title" className={styles.sectionTitle}>
                  <bdi>{instructor.displayName}</bdi>
                </h2>
                {instructor.headline && <span className="tp-muted">{instructor.headline}</span>}
              </span>
            </div>
            {instructor.bio && <p>{instructor.bio}</p>}
            <div className={styles.instructorLinks}>
              {instructor.instagramHandle && (
                <a
                  className="tp-btn tp-btn--secondary tp-btn--sm"
                  href={`https://www.instagram.com/${instructor.instagramHandle}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="camera" />
                  <bdi dir="ltr">@{instructor.instagramHandle}</bdi>
                </a>
              )}
              {instructor.playlistUrl && (
                <a
                  className="tp-btn tp-btn--secondary tp-btn--sm"
                  href={instructor.playlistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="music" />
                  הפלייליסט של השיעור
                </a>
              )}
            </div>
          </Card>
        )}

      <Card as="section" className={styles.classCard} aria-label="פרטי השיעור">
        {session.instructor && (
          <div className={styles.sheetDetail}>
            <Avatar name={session.instructor.displayName} />
            <bdi className={styles.studioName}>{session.instructor.displayName}</bdi>
          </div>
        )}
        {session.room && (
          <div className={styles.sheetDetail}>
            <span className="tp-icon-tile tp-icon-tile--sm">
              <Icon name="map-pin" />
            </span>
            <bdi>{session.room.name}</bdi>
          </div>
        )}
        {session.status === "scheduled" && !started && (
          <div className={styles.sheetDetail}>
            <span className="tp-icon-tile tp-icon-tile--sm">
              <Icon name="clock" />
            </span>
            <span>{cancelWindowText(state, deadlineText, inFreeWindow, policy.data)}</span>
          </div>
        )}
      </Card>

      {session.status === "scheduled" && (
        <Card as="section" small tone="cream" className={styles.sheetDetail} aria-label="מקומות">
          <span className="tp-icon-tile tp-icon-tile--sm">
            <Icon name="user" />
          </span>
          <span>
            {session.bookedCount} מתוך {session.capacity} רשומים · {spotsText(session)}
            {open && freeSpots(session) === 0 && !canWait && " · רשימת ההמתנה סגורה"}
          </span>
        </Card>
      )}

      <div className={styles.sheetActions}>
        {state === "booked" && !started && session.status === "scheduled" && (
          <>
            <Button size="lg" block icon="qr" onClick={() => setPassOpen(true)}>
              כרטיס כניסה
            </Button>
            {/* A file, not a subscription: cancelling later does not remove the calendar entry (docs/29 16.3). */}
            <Button
              variant="secondary"
              size="lg"
              block
              icon="calendar"
              loading={calendar.isPending}
              onClick={() => {
                const bookingId = session.myBooking?.bookingId;
                if (bookingId)
                  calendar.mutate(bookingId, { onSuccess: (file) => saveFile(file, `tempo-${session.localDate}.ics`) });
              }}
            >
              הוספה ליומן
            </Button>
            <Button variant="ghost-danger" size="lg" block onClick={() => setConfirming(true)}>
              ביטול הרשמה
            </Button>
          </>
        )}
        {state === "waitlisted" && (
          <Button variant="ghost-danger" size="lg" block onClick={() => setConfirming(true)}>
            יציאה מרשימת ההמתנה
          </Button>
        )}
        {(canBook || canWait) && (
          <Button
            size="lg"
            block
            loading={flow.pendingId === session.id}
            disabled={paused}
            onClick={() => {
              flow.reset();
              setSheetOpen(true);
            }}
          >
            {canBook ? "הרשמה לשיעור" : "הצטרפות לרשימת ההמתנה"}
          </Button>
        )}
        {state === "none" && !canBook && !canWait && (
          <ButtonLink to={`/book?day=${session.localDate}`} variant="secondary" block>
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
        session={sheetOpen && (canBook || canWait) ? session : null}
        timeZone={timeZone}
        today={today}
        policy={policy.data}
        now={now}
        pending={flow.pendingId !== undefined}
        error={flow.error}
        spot={
          canBook && chosenSpot && chosenSpot.state === "free"
            ? { label: chosenSpot.label, note: chosenSpot.id === map?.usualSpotId ? "המקום הקבוע שלך" : undefined }
            : null
        }
        spotsAuto={map !== null}
        onConfirm={(target) =>
          flow.run(
            target,
            (booking) => {
              setSheetOpen(false);
              setChosen(null);
              setFocusTitle((count) => count + 1);
              if (booking.status !== "booked") return false;
              setBooked(booking);
              return true;
            },
            canBook && chosenSpot?.state === "free" ? chosenSpot.id : null,
          )
        }
        onClose={() => {
          flow.reset();
          setSheetOpen(false);
        }}
      />
      <BookedDialog
        studio={studio}
        session={session}
        booking={booked}
        timeZone={timeZone}
        today={today}
        freeCancelUntil={inFreeWindow ? deadlineText : null}
        calendar={calendar}
        onClose={() => {
          setBooked(null);
          setFocusTitle((count) => count + 1);
        }}
      />
      <CheckinPass organizationId={studio.id} timeZone={timeZone} open={passOpen} onClose={() => setPassOpen(false)} />
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

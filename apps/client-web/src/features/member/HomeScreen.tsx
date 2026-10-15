import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Banner,
  ButtonLink,
  Card,
  EmptyState,
  EventCard,
  Icon,
  ProgressRing,
  WeekStrip,
  shortDate,
} from "../../shared/design-system";
import { nameOf, useAccount } from "../../account/account";
import { addDays, dayOfWeek, startOfWeek, type IsoDate } from "../../shared/utilities/dates";
import { freeSpots, myState, waitText } from "./bookingState";
import { useProfile } from "./data";
import { dayName, relativeDay } from "./format";
import styles from "./member.module.css";
import { metaLine } from "./passText";
import {
  useInbox,
  useSessions,
  useStudio,
  useStudioClock,
  useUpcomingBookings,
  type Session,
  type Studio,
} from "./studio";
import { knownNotices } from "./InboxScreen";
import { ListSkeleton, LoadError } from "./StudioGate";
import { useNow } from "./clock";
import { clockTime, defaultTimeZone, hasStarted, studioToday } from "./studioTime";

function badge(session: Session, now: Date): string {
  if (session.status === "cancelled") return "בוטל";
  const state = myState(session, now);
  if (state === "booked") return "נרשמת";
  if (state === "waitlisted") return waitText(session.myBooking?.waitlistPosition);
  if (hasStarted(session.startsAt, now)) return "התחיל";
  const free = freeSpots(session);
  return free === 0 ? "מלא" : free === 1 ? "מקום אחד" : `${free} מקומות`;
}

export function HomeScreen() {
  const studio = useStudio();
  return studio ? <StudioHome studio={studio} /> : <NoStudioHome />;
}

function NoStudioHome() {
  const today = studioToday(defaultTimeZone, useNow());
  return (
    <HomeFrame today={today} studio={null} bell={null}>
      <EmptyState icon="calendar" title="עוד לא הצטרפת לסטודיו">
        בקשו מהסטודיו קישור הצטרפות או הזמנה במייל.
      </EmptyState>
    </HomeFrame>
  );
}

/** The greeting, with the date, the studio and the bell. */
function HomeFrame({
  today,
  studio,
  bell,
  children,
}: {
  today: IsoDate;
  studio: Studio | null;
  bell: ReactNode;
  children: ReactNode;
}) {
  const me = useAccount();
  const firstName = nameOf(me).split(" ")[0];
  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className="tp-eyebrow">
            {dayName(today)} · {shortDate(today)}
            {studio && <> · {studio.name}</>}
          </span>
          <h1 className={styles.title}>היי {firstName}</h1>
        </div>
        {bell}
      </header>
      {children}
    </main>
  );
}

function StudioHome({ studio }: { studio: Studio }) {
  const { timeZone, now, today } = useStudioClock(studio.id);
  const inbox = useInbox(studio.id);
  const [day, setDay] = useState(today);
  const week = Array.from({ length: 7 }, (_, offset) => addDays(startOfWeek(today), offset));
  const upcoming = useUpcomingBookings(studio.id);
  const sessions = useSessions(studio.id, startOfWeek(today), addDays(startOfWeek(today), 6));
  // The goal and the streak stay sample data until attendance stats exist.
  const profile = useProfile();

  const next = upcoming.data?.find((booking) => booking.status === "booked");
  const dayClasses = (sessions.data ?? []).filter(
    (session) => session.localDate === day && !hasStarted(session.endsAt, now),
  );
  const dayTitle =
    day === today ? "השיעורים של היום" : day === addDays(today, 1) ? "השיעורים של מחר" : `השיעורים של ${dayName(day)}`;
  const emptyText =
    day < today ? "היום הזה כבר עבר" : dayOfWeek(day) === 6 ? "אין שיעורים בשבת" : "אין שיעורים ביום הזה";

  const promotion = inbox.data
    ? knownNotices(inbox.data.items).find((item) => item.kind === "booking.promoted" && !item.readAt)
    : undefined;
  const unread = inbox.data ? knownNotices(inbox.data.items).filter((item) => !item.readAt).length : 0;
  const bell = (
    <Link
      to="/inbox"
      className={`tp-btn tp-btn--icon ${styles.bell}`}
      aria-label={unread === 0 ? "התראות" : unread === 1 ? "התראות, אחת חדשה" : `התראות, ${unread} חדשות`}
    >
      <Icon name="bell" />
      {unread > 0 && (
        <span className={`tp-chip tp-chip--count ${styles.bellCount}`} aria-hidden="true">
          {unread}
        </span>
      )}
    </Link>
  );

  return (
    <HomeFrame today={today} studio={studio} bell={bell}>
      {promotion && (
        <Banner tone="success" icon="check">
          התפנה מקום מרשימת ההמתנה, ונרשמת אוטומטית. <Link to="/inbox">להתראות</Link>
        </Banner>
      )}
      {next ? (
        <Card as="section" tone="elevated" className={styles.next} aria-labelledby="next-class">
          <span className="tp-eyebrow">השיעור הבא שלך</span>
          <h2 id="next-class" className={styles.nextTitle}>
            {next.session.classType.name}
          </h2>
          <span>
            {metaLine([
              `${relativeDay(next.session.localDate, today)} ${clockTime(next.session.startsAt, timeZone)}`,
              next.session.instructor?.displayName,
              next.session.room?.name,
            ])}
          </span>
          <div className={styles.nextActions}>
            <ButtonLink to={`/classes/${next.session.id}`} variant="rose">
              לפרטי השיעור
            </ButtonLink>
          </div>
        </Card>
      ) : upcoming.isError ? (
        <Card as="section" tone="elevated" className={styles.next} aria-labelledby="next-class">
          <h2 id="next-class" className={styles.nextTitle}>
            השיעור הבא שלך
          </h2>
          <LoadError error={upcoming.error} onRetry={() => void upcoming.refetch()}>
            לא הצלחנו לטעון את ההזמנות שלך
          </LoadError>
        </Card>
      ) : (
        <Card as="section" tone="elevated" className={styles.next} aria-labelledby="next-class">
          <h2 id="next-class" className={styles.nextTitle}>
            {upcoming.isPending ? "השיעור הבא שלך" : "אין לך שיעור קרוב"}
          </h2>
          <div className={styles.nextActions}>
            <ButtonLink to="/book" variant="rose">
              הרשמה לשיעור
            </ButtonLink>
          </div>
        </Card>
      )}

      <WeekStrip days={week} value={day} onChange={setDay} today={today} />

      <section aria-labelledby="day-classes" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="day-classes" className={styles.sectionTitle}>
            {dayTitle}
          </h2>
          <Link to="/book">לכל המערכת</Link>
        </div>
        {sessions.isPending ? (
          <ListSkeleton rows={2} />
        ) : sessions.isError ? (
          <LoadError error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : dayClasses.length > 0 && day >= today ? (
          <ul className={styles.list}>
            {dayClasses.map((session) => (
              <li key={session.id}>
                <EventCard
                  to={`/classes/${session.id}`}
                  title={session.classType.name}
                  meta={metaLine([clockTime(session.startsAt, timeZone), session.instructor?.displayName])}
                  color={session.classType.color}
                  fill={session.capacity > 0 ? session.bookedCount / session.capacity : 0}
                  badge={badge(session, now)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="calendar"
            title={day === today && dayOfWeek(day) !== 6 ? "אין עוד שיעורים היום" : emptyText}
          />
        )}
      </section>

      {profile.data && (
        <section aria-label="ההתקדמות שלך" className={styles.stats}>
          <Card small className={styles.stat}>
            <ProgressRing
              size="sm"
              value={profile.data.visitsThisMonth}
              max={profile.data.monthlyGoal}
              label={`ביקורים החודש, מתוך יעד של ${profile.data.monthlyGoal}`}
            >
              {profile.data.visitsThisMonth}
            </ProgressRing>
            <span className="tp-stat__label">ביקורים החודש</span>
          </Card>
          <Card small tone="base" className={styles.stat}>
            <span className="tp-icon-tile tp-icon-tile--sm">
              <Icon name="check" />
            </span>
            <span className="tp-stat__label">{profile.data.streakWeeks} שבועות ברצף עם שלושה שיעורים</span>
          </Card>
        </section>
      )}
    </HomeFrame>
  );
}

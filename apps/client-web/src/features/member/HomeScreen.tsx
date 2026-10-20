import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  Avatar,
  ButtonLink,
  EmptyState,
  IconButtonLink,
  Icon,
  ProgressRing,
  WeekStrip,
  shortDate,
  useToast,
} from "../../shared/design-system";
import { nameOf, useAccount } from "../../account/account";
import { addDays, dayOfWeek, formatDate, startOfWeek, type IsoDate } from "../../shared/utilities/dates";
import { freeSpots, myState, waitText } from "./bookingState";
import { useInstructors, useMyProfile } from "./experience";
import { dayName, relativeDay } from "./format";
import { InstallAppCard } from "./InstallApp";
import styles from "./member.module.css";
import { metaLine } from "./passText";
import { CheckinPass, CountdownRing } from "./Premium";
import { streakText, useMyProgress, type MyProgress } from "./progress";
import {
  useInbox,
  useMyPasses,
  useSessions,
  useStudio,
  useStudioClock,
  useUpcomingBookings,
  type MyBooking,
  type Pass,
  type Session,
  type Studio,
} from "./studio";
import { knownNotices } from "./InboxScreen";
import { ListSkeleton, LoadError } from "./StudioGate";
import { useNow } from "./clock";
import { clockTime, defaultTimeZone, hasStarted, minutesBetween, studioToday } from "./studioTime";
import { StudioNotices } from "./StudioNotices";
import { StudioSwitcher, useSwitchableStudios } from "./StudioSwitcher";
import { useStudioPath } from "../../app/studioPath";
import { PublicStudioPage } from "../public/PublicStudioPage";

/** The state chip of a class row: the member's own place first, then what is left. */
function badge(session: Session, now: Date): { text: string; tone: "sage" | "rose" | "amber" | "plain" } {
  if (session.status === "cancelled") return { text: "בוטל", tone: "plain" };
  const state = myState(session, now);
  if (state === "booked") return { text: "נרשמת", tone: "sage" };
  if (state === "waitlisted") return { text: waitText(session.myBooking?.waitlistPosition), tone: "amber" };
  if (hasStarted(session.startsAt, now)) return { text: "התחיל", tone: "plain" };
  const free = freeSpots(session);
  if (free === 0) {
    const waiting = session.waitlistCount;
    return {
      text: waiting === 0 ? "מלא · המתנה" : waiting === 1 ? "מלא · ממתין אחד" : `מלא · ${waiting} ממתינים`,
      tone: "amber",
    };
  }
  return { text: free === 1 ? "מקום אחרון" : `נשארו ${free}`, tone: "rose" };
}

const chipClass = {
  sage: "tp-chip tp-chip--success",
  rose: "tp-chip tp-chip--rose",
  amber: "tp-chip tp-chip--warning",
  plain: "tp-chip",
};

/** Good morning, afternoon or evening, by the studio's clock (P2: one sentence for now). */
function greeting(timeZone: string, now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  return "ערב טוב";
}

export function HomeScreen() {
  const studio = useStudio();
  const studioPath = useStudioPath();
  if (studio) return <StudioHome studio={studio} />;
  // A studio's own app shows a visitor who has not joined it the studio's public page, with the join button.
  return studioPath ? <PublicStudioPage /> : <NoStudioHome />;
}

function NoStudioHome() {
  const now = useNow();
  const today = studioToday(defaultTimeZone, now);
  return (
    <HomeFrame today={today} studio={null} bell={null} hello={greeting(defaultTimeZone, now)} avatar={null}>
      <EmptyState icon="calendar" title="עוד לא הצטרפת לסטודיו">
        בקשו מהסטודיו קישור הצטרפות או הזמנה במייל.
      </EmptyState>
    </HomeFrame>
  );
}

/** The greeting in display type, with the date, the studio, the member's picture and the bell. */
function HomeFrame({
  today,
  studio,
  bell,
  hello,
  avatar,
  children,
}: {
  today: IsoDate;
  studio: Studio | null;
  bell: ReactNode;
  hello: string;
  avatar: string | null | undefined;
  children: ReactNode;
}) {
  const me = useAccount();
  const name = nameOf(me);
  const firstName = name.split(" ")[0];
  const switching = Boolean(useSwitchableStudios()) && studio;
  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen} ${styles.home}`}>
      <header className={styles.header}>
        <Link to="/profile" aria-label="הפרופיל שלי" className={styles.meLink}>
          <Avatar name={name} src={avatar ?? undefined} size="lg" />
        </Link>
        <div className={styles.heading}>
          {switching && <StudioSwitcher studio={studio} />}
          <span className="tp-eyebrow">
            {studio && !switching && <>{studio.name} · </>}
            {dayName(today)}, {shortDate(today)}
          </span>
          <h1 className={styles.title}>
            {hello}, {firstName}
          </h1>
        </div>
        {bell}
      </header>
      <StudioNotices />
      {children}
    </main>
  );
}

/** Promotions already told in this tab, through reloads too; the bell keeps them until they are read. */
const toldKey = "tempo.home.toldPromotion";

function toldBefore(id: string): boolean {
  try {
    if (window.sessionStorage.getItem(toldKey) === id) return true;
    window.sessionStorage.setItem(toldKey, id);
  } catch {
    // Storage blocked: the toast may come again on the next visit, which is harmless.
  }
  return false;
}

/**
 * A place opened from the waitlist: a toast, once per notice. The inbox answers after the hero is drawn, so a banner
 * above it pushed the whole home down (CLS 0.107 at 360px, board #347, O5); a toast covers nothing the member reads.
 */
function useTellPromotion(id: string | undefined) {
  const toast = useToast();
  const navigate = useNavigate();
  useEffect(() => {
    if (!id || toldBefore(id)) return;
    toast.show({
      tone: "success",
      icon: "check",
      message: "התפנה מקום מרשימת ההמתנה, ונרשמת אוטומטית.",
      action: { label: "להתראות", onClick: () => void navigate("/inbox") },
    });
  }, [id, toast, navigate]);
}

function StudioHome({ studio }: { studio: Studio }) {
  const { timeZone, now, today } = useStudioClock(studio.id);
  const inbox = useInbox(studio.id);
  const [day, setDay] = useState(today);
  const week = Array.from({ length: 7 }, (_, offset) => addDays(startOfWeek(today), offset));
  const upcoming = useUpcomingBookings(studio.id);
  const sessions = useSessions(studio.id, startOfWeek(today), addDays(startOfWeek(today), 6));
  const progress = useMyProgress(studio.id);
  const passes = useMyPasses(studio.id);
  const profile = useMyProfile(studio.id);
  const instructors = useInstructors(studio.id);
  // The installed app's "check-in pass" shortcut (manifest.webmanifest) opens the pass straight away.
  const [params, setParams] = useSearchParams();

  const next = upcoming.data?.find((booking) => booking.status === "booked");
  const dayClasses = (sessions.data ?? []).filter(
    (session) => session.localDate === day && !hasStarted(session.endsAt, now),
  );
  const bookedDays = new Set(
    (upcoming.data ?? []).filter((b) => b.status === "booked").map((b) => b.session.localDate),
  );
  const dayTitle =
    day === today ? "השיעורים של היום" : day === addDays(today, 1) ? "השיעורים של מחר" : `השיעורים של ${dayName(day)}`;
  const emptyText =
    day < today ? "היום הזה כבר עבר" : dayOfWeek(day) === 6 ? "אין שיעורים בשבת" : "אין שיעורים ביום הזה";

  const promotion = inbox.data
    ? knownNotices(inbox.data.items).find((item) => item.kind === "booking.promoted" && !item.readAt)
    : undefined;
  useTellPromotion(promotion?.id);
  const unread = inbox.data ? knownNotices(inbox.data.items).filter((item) => !item.readAt).length : 0;
  const bell = (
    <IconButtonLink
      to="/inbox"
      icon="bell"
      label={unread === 0 ? "התראות" : unread === 1 ? "התראות, אחת חדשה" : `התראות, ${unread} חדשות`}
      count={unread}
    />
  );
  const pass = (passes.data ?? []).find((p) => p.status === "active" && p.endsOn >= today);

  return (
    <HomeFrame
      today={today}
      studio={studio}
      bell={bell}
      hello={greeting(timeZone, now)}
      avatar={profile.data?.avatarUrl}
    >
      <CheckinPass
        organizationId={studio.id}
        timeZone={timeZone}
        open={params.get("open") === "checkin"}
        onClose={() => setParams({}, { replace: true })}
      />
      {next ? (
        <NextClassHero
          organizationId={studio.id}
          booking={next}
          timeZone={timeZone}
          today={today}
          now={now}
          instructorPhoto={
            next.session.instructor ? instructors.data?.get(next.session.instructor.membershipId)?.photoSmallUrl : null
          }
        />
      ) : upcoming.isError ? (
        <section className="tp-hero" aria-labelledby="next-class" style={{ minHeight: 220 }}>
          <div className="tp-hero__body">
            <div className="tp-hero__text">
              <h2 id="next-class" className="tp-hero__title">
                השיעור הבא שלך
              </h2>
            </div>
            <LoadError error={upcoming.error} onRetry={() => void upcoming.refetch()}>
              לא הצלחנו לטעון את ההזמנות שלך
            </LoadError>
          </div>
        </section>
      ) : (
        <section className="tp-hero" aria-labelledby="next-class" style={{ minHeight: 260 }}>
          <div className="tp-hero__body">
            <div className="tp-hero__text">
              <span className="tp-eyebrow" style={{ color: "#ffffffe6" }}>
                {upcoming.isPending ? "רגע" : "השבוע עוד לפניך"}
              </span>
              <h2 id="next-class" className="tp-hero__title">
                {upcoming.isPending ? "השיעור הבא שלך" : "אין לך שיעור קרוב"}
              </h2>
            </div>
            <div className={styles.heroActions}>
              <ButtonLink to="/book" className="tp-btn--white">
                הרשמה לשיעור
              </ButtonLink>
            </div>
          </div>
        </section>
      )}

      {/* After a booking, never on the first visit (board #347, P-3). */}
      {next && <InstallAppCard />}

      <WeekStrip days={week} value={day} onChange={setDay} today={today} marked={bookedDays} />

      <section aria-labelledby="day-classes" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="day-classes" className={styles.sectionTitle}>
            {dayTitle}
          </h2>
          <Link to="/book" className="tp-hit">
            לכל המערכת
          </Link>
        </div>
        {sessions.isPending ? (
          <ListSkeleton rows={2} />
        ) : sessions.isError ? (
          <LoadError error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : dayClasses.length > 0 && day >= today ? (
          <ul className={styles.list}>
            {dayClasses.map((session) => {
              const chip = badge(session, now);
              const mine = myState(session, now) === "booked";
              return (
                <li key={session.id}>
                  <Link to={`/classes/${session.id}`} className={`tp-cover-row${mine ? " tp-cover-row--mine" : ""}`}>
                    {session.classType.coverSmallUrl ? (
                      <img className="tp-cover" src={session.classType.coverSmallUrl} alt="" />
                    ) : (
                      <span className="tp-cover" aria-hidden="true" />
                    )}
                    <span className="tp-cover-row__body">
                      <span className="tp-cover-row__title">
                        <bdi>{session.classType.name}</bdi>
                      </span>
                      <span className="tp-cover-row__meta">
                        {metaLine([
                          session.instructor ? `עם ${session.instructor.displayName}` : null,
                          `${minutesBetween(session.startsAt, session.endsAt)} דקות`,
                        ])}
                      </span>
                    </span>
                    <span className="tp-cover-row__end">
                      <span className="tp-cover-row__time">{clockTime(session.startsAt, timeZone)}</span>
                      <span className={chipClass[chip.tone]}>{chip.text}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon="calendar"
            title={day === today && dayOfWeek(day) !== 6 ? "אין עוד שיעורים היום" : emptyText}
          />
        )}
      </section>

      {progress.data && <Pace progress={progress.data} />}
      {pass && <PassCard pass={pass} studioName={studio.name} />}
    </HomeFrame>
  );
}

/**
 * The one important thing (P2): the next class on its photo, in display type, with a glass panel that counts down,
 * says when check-in opens or what the instructor asked, and opens the check-in pass.
 */
function NextClassHero({
  organizationId,
  booking,
  timeZone,
  today,
  now,
  instructorPhoto,
}: {
  organizationId: string;
  booking: MyBooking;
  timeZone: string;
  today: IsoDate;
  now: Date;
  instructorPhoto: string | null | undefined;
}) {
  const [passOpen, setPassOpen] = useState(false);
  const session = booking.session;
  const startsAt = new Date(session.startsAt);
  const minutesLeft = Math.max(0, Math.round((startsAt.getTime() - now.getTime()) / 60_000));
  const opensAt = new Date(startsAt.getTime() - 30 * 60_000);
  const checkinOpen = now.getTime() >= opensAt.getTime();
  return (
    <section className="tp-hero" aria-labelledby="next-class">
      {session.classType.coverUrl && <img className="tp-hero__photo" src={session.classType.coverUrl} alt="" />}
      <div className="tp-hero__top">
        <span className="tp-chip tp-glass-dark">
          <span className="tp-live" aria-hidden="true" />
          השיעור הבא שלך
        </span>
        {booking.spot && <span className="tp-chip tp-glass-dark">מכשיר {booking.spot.label}</span>}
      </div>
      <div className="tp-hero__body">
        <Link to={`/classes/${session.id}`} className={`tp-hero__text ${styles.heroLink}`} aria-label="לפרטי השיעור">
          <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.9 }}>
            {relativeDay(session.localDate, today)} {clockTime(session.startsAt, timeZone)}
          </span>
          <h2 id="next-class" className="tp-hero__title">
            <bdi>{session.classType.name}</bdi>
          </h2>
          <span className="tp-hero__meta">
            {session.instructor && (
              <Avatar name={session.instructor.displayName} src={instructorPhoto ?? undefined} size="sm" />
            )}
            <span>
              {metaLine([
                session.instructor ? `עם ${session.instructor.displayName}` : null,
                `${minutesBetween(session.startsAt, session.endsAt)} דקות`,
                session.room?.name,
              ])}
            </span>
          </span>
        </Link>
        <div className={`tp-glass ${styles.heroPanel}`}>
          {minutesLeft <= 180 ? (
            <CountdownRing minutesLeft={minutesLeft} />
          ) : (
            <span className={styles.heroDate}>
              <span className="tp-display">{session.localDate.slice(8, 10)}</span>
              <small>{formatDate(session.localDate).slice(3)}</small>
            </span>
          )}
          <div className={styles.heroPanelText}>
            <strong>{checkinOpen ? "הצ׳ק־אין פתוח" : `צ׳ק־אין מ-${clockTime(opensAt, timeZone)}`}</strong>
            <span className="tp-caption">
              {session.memberNote ? (
                <>
                  <bdi>{session.instructor?.displayName ?? "המדריכה"}</bdi>: {session.memberNote}
                </>
              ) : (
                "הקוד מתחלף כל חצי דקה"
              )}
            </span>
          </div>
          <button type="button" className="tp-btn tp-btn--sm" onClick={() => setPassOpen(true)}>
            <Icon name="qr" />
            כניסה
          </button>
        </div>
      </div>
      <CheckinPass
        organizationId={organizationId}
        timeZone={timeZone}
        open={passOpen}
        onClose={() => setPassOpen(false)}
      />
    </section>
  );
}

/** Visits this month, the streak, and twelve weeks of dots (docs/33 section 10); the goal is monthly. */
function Pace({ progress }: { progress: MyProgress }) {
  const { visitsThisMonth: visits, monthlyGoal: goal, streakWeeks } = progress;
  const weeks = progress.weeks ?? [];
  const weeklyGoal = goal ? Math.max(1, Math.round(goal / 4)) : 3;
  return (
    <section aria-label="ההתקדמות שלך" className={`tp-card ${styles.pace}`}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>הקצב שלך</h2>
        {goal ? (
          <span className="tp-chip">יעד: {goal} בחודש</span>
        ) : (
          <Link to="/profile" className="tp-caption tp-hit">
            להגדרת יעד חודשי
          </Link>
        )}
      </div>
      <div className={styles.paceStats}>
        <span>
          {goal ? (
            <ProgressRing size="sm" value={visits} max={goal} label={`ביקורים החודש: ${visits} מתוך יעד של ${goal}`}>
              {visits}
            </ProgressRing>
          ) : (
            <b className="tp-display tp-stat__value">{visits}</b>
          )}
          <span className="tp-caption">ביקורים החודש{goal ? `, מתוך ${goal}` : ""}</span>
        </span>
        <span>
          <b className="tp-display" style={{ color: "var(--rose-ink)" }}>
            {streakWeeks}
          </b>
          <span className="tp-caption">{streakText(streakWeeks)}</span>
        </span>
      </div>
      {weeks.length > 0 && (
        <div className="tp-pace" role="img" aria-label={`ביקורים בכל שבוע, ${weeks.length} השבועות האחרונים`}>
          {weeks.map((week, index) => (
            <div
              key={week.weekStart}
              className={`tp-pace__week${index === weeks.length - 1 ? " tp-pace__week--now" : ""}`}
            >
              {[0, 1, 2, 3].map((slot) => {
                const done = slot < week.attended;
                const booked = !done && slot < week.attended + week.booked;
                const cls = done
                  ? week.attended >= weeklyGoal
                    ? "tp-pace__dot tp-pace__dot--goal"
                    : "tp-pace__dot tp-pace__dot--done"
                  : booked
                    ? "tp-pace__dot tp-pace__dot--booked"
                    : "tp-pace__dot";
                return <span key={slot} className={cls} />;
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The pass as a card in a wallet: entries left in display type, one pip per entry, valid until when. */
function PassCard({ pass, studioName }: { pass: Pass; studioName: string }) {
  const entries = pass.entries ?? null;
  const left = pass.entriesLeft ?? null;
  return (
    <section aria-label="הכרטיסייה שלך" className="tp-passcard">
      <div className={styles.passHead}>
        <span>
          <span className="tp-caption" style={{ color: "#ffffffd9" }}>
            {studioName}
          </span>
          <h3>
            <bdi>{pass.product.name}</bdi>
          </h3>
        </span>
        <span className="tp-chip tp-glass-dark">בתוקף עד {formatDate(pass.endsOn)}</span>
      </div>
      <div className={styles.passBody}>
        {left !== null ? (
          <>
            <b className="tp-display tp-display--light">{left}</b>
            <span>{left === 1 ? "כניסה אחרונה" : "כניסות נותרו"}</span>
          </>
        ) : (
          <span>מנוי פעיל</span>
        )}
      </div>
      {entries !== null && entries <= 30 && left !== null && (
        <div className="tp-passcard__pips" aria-hidden="true">
          {Array.from({ length: entries }, (_, index) => (
            <span key={index} className={`tp-passcard__pip${index >= left ? " tp-passcard__pip--used" : ""}`} />
          ))}
        </div>
      )}
    </section>
  );
}

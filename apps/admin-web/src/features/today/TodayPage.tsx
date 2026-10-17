import { useState } from "react";
import { errorMessage } from "../../api/errors";
import {
  Banner,
  ButtonLink,
  Chip,
  ClassRow,
  EmptyState,
  Segmented,
  Skeleton,
  TimeSlot,
  type ChipTone,
} from "../../shared/design-system";
import { StudioClock } from "../../shared/studio/StudioClock";
import { addDays, dayOfWeek, formatDate, todayIn } from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";
import { useStudio } from "../console/studio";
import { occupancy, sessionBadge, useSessions, weekdayNames, type Session } from "../schedule/queries";
import styles from "./today.module.css";

type Day = "today" | "tomorrow";

/**
 * `/o/:slug/today`: the day's classes on the studio's clock, the caller's own first. The coach's screen at the studio
 * door, on a phone or at the desk (D15, #317): each class opens its roster and attendance.
 */
export function TodayPage() {
  return <StudioClock>{(timeZone) => <DayView timeZone={timeZone} />}</StudioClock>;
}

function DayView({ timeZone }: { timeZone: string }) {
  const studio = useStudio();
  const [day, setDay] = useState<Day>("today");
  // When the page opened: a class that started meanwhile shows as started after a reload, as on the class page.
  const [openedAt] = useState(() => Date.now());
  const today = todayIn(timeZone);
  const date = day === "today" ? today : addDays(today, 1);
  const sessions = useSessions(date, date);

  const all = [...(sessions.data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const mine = all.filter((session) => session.instructor?.membershipId === studio.membership.membershipId);
  const others = all.filter((session) => !mine.includes(session));
  const dayWord = day === "today" ? "היום" : "מחר";

  const list = (items: Session[]) => (
    <ul className={styles.list}>
      {items.map((session) => (
        <SessionRow key={session.id} session={session} timeZone={timeZone} openedAt={openedAt} />
      ))}
    </ul>
  );

  return (
    <>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className="tp-eyebrow tp-num">
            יום {weekdayNames[dayOfWeek(date)]} · {formatDate(date)}
          </span>
          <h1>היום בסטודיו</h1>
        </div>
        <div className={styles.tools}>
          <Segmented
            label="איזה יום"
            value={day}
            onChange={setDay}
            options={[
              { value: "today", label: "היום" },
              { value: "tomorrow", label: "מחר" },
            ]}
          />
          <ButtonLink to={`/o/${studio.slug}/schedule`} variant="secondary" icon="calendar">
            מערכת שבועית
          </ButtonLink>
        </div>
      </header>

      {sessions.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(sessions.error, "לא הצלחנו לטעון את השיעורים. נסו שוב.")}
        </Banner>
      ) : !sessions.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את השיעורים…</span>
          <Skeleton height={96} />
          <Skeleton height={96} />
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={`אין שיעורים ${dayWord}.`}
          action={
            <ButtonLink to={`/o/${studio.slug}/schedule`} variant="secondary">
              למערכת השבועית
            </ButtonLink>
          }
        >
          שיעור חדש או שיעור קבוע נוספים מהמערכת השבועית.
        </EmptyState>
      ) : mine.length > 0 ? (
        <>
          <section className={styles.section} aria-labelledby="today-mine">
            <h2 id="today-mine">השיעורים שלי</h2>
            {list(mine)}
          </section>
          {others.length > 0 && (
            <section className={styles.section} aria-labelledby="today-others">
              <h2 id="today-others">שאר השיעורים {dayWord}</h2>
              {list(others)}
            </section>
          )}
        </>
      ) : (
        <section className={styles.section} aria-labelledby="today-all">
          <h2 id="today-all">השיעורים {dayWord}</h2>
          {list(all)}
        </section>
      )}
    </>
  );
}

/** One class: when, what, where and with whom, how full, and its state now. Opens the class page. */
function SessionRow({ session, timeZone, openedAt }: { session: Session; timeZone: string; openedAt: number }) {
  const studio = useStudio();
  const start = clockTime(session.startsAt, timeZone);
  const end = clockTime(session.endsAt, timeZone);
  const minutes = Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000);
  const where = [session.room?.name, session.instructor?.displayName].filter(Boolean).join(" · ");
  return (
    <ClassRow
      as="li"
      to={`/o/${studio.slug}/schedule/sessions/${session.id}`}
      slot={<TimeSlot time={start}>{`${minutes} דק׳`}</TimeSlot>}
      title={session.classType.name}
      meta={
        <>
          <span className="tp-num">
            {start} עד {end}
          </span>
          {where && ` · ${where}`}
          <br />
          {session.status === "cancelled" ? "המתאמנים קיבלו הודעה" : occupancy(session)}
        </>
      }
      actions={<StateChip session={session} openedAt={openedAt} />}
    />
  );
}

function StateChip({ session, openedAt }: { session: Session; openedAt: number }) {
  const [tone, text]: [ChipTone, string] =
    session.status === "cancelled"
      ? ["danger", "בוטל"]
      : new Date(session.endsAt).getTime() <= openedAt
        ? ["neutral", "הסתיים"]
        : new Date(session.startsAt).getTime() <= openedAt
          ? ["brand", "עכשיו"]
          : session.bookedCount >= session.capacity
            ? ["warning", sessionBadge(session)]
            : ["success", sessionBadge(session)];
  return <Chip tone={tone}>{text}</Chip>;
}

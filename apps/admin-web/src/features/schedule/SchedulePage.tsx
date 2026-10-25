import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  Banner,
  Button,
  EmptyState,
  EventCard,
  FilterChips,
  IconButton,
  Segmented,
  Skeleton,
  WeekStrip,
  cx,
} from "../../shared/design-system";
import { StudioClock } from "../../shared/studio/StudioClock";
import { useMediaQuery } from "../../shared/useMediaQuery";
import {
  addDays,
  dayOfWeek,
  formatDate,
  formatDayMonth,
  fromIsoDate,
  startOfWeek,
  todayIn,
  type IsoDate,
} from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";
import { errorMessage } from "../../api/errors";
import { useStudio } from "../console/studio";
import { AnnouncementDialog } from "./AnnouncementDialog";
import { NewClassDialog } from "./NewClassDialog";
import { occupancy, sessionBadge, useSessions, weekdayNames, type Session } from "./queries";
import styles from "./schedule.module.css";

const allInstructors = "all";

/** Seven columns need a tablet held sideways or a computer; narrower, the week is a strip of days over one day's list. */
const WEEK_GRID = "(min-width: 900px)";

/** `/o/:slug/schedule`: the week's classes, Sunday to Saturday on the studio's clock (Schedule mockup). */
export function SchedulePage() {
  return <StudioClock>{(timeZone) => <WeekView timeZone={timeZone} />}</StudioClock>;
}

function WeekView({ timeZone }: { timeZone: string }) {
  const studio = useStudio();
  const today = todayIn(timeZone);
  const [params, setParams] = useSearchParams();
  const asked = params.get("week");
  const week = startOfWeek(asked && fromIsoDate(asked) ? asked : today);
  const days = Array.from({ length: 7 }, (_, offset) => addDays(week, offset));
  const sessions = useSessions(week, days[6]!);
  const [instructor, setInstructor] = useState(allInstructors);
  const [creating, setCreating] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const manage = studio.can("schedule.manage");
  const wide = useMediaQuery(WEEK_GRID, true);
  // On a computer the seven columns, or one day as a list on request (#487); narrower, always the day.
  const view = params.get("view") === "day" ? "day" : "week";
  const grid = wide && view === "week";
  const [picked, setPicked] = useState<IsoDate | null>(null);
  // The picked day while it is in the week on screen; else today in this week, else its Sunday.
  const agendaDay = picked && days.includes(picked) ? picked : days.includes(today) ? today : week;

  const show = (sunday: IsoDate, next: "week" | "day" = view) =>
    setParams({
      ...(sunday === startOfWeek(today) ? {} : { week: sunday }),
      ...(next === "day" ? { view: "day" } : {}),
    });
  const goTo = (sunday: IsoDate) => show(sunday);

  // The filter offers the instructors who teach this week.
  const teaching = new Map<string, string>();
  for (const session of sessions.data ?? []) {
    if (session.instructor) teaching.set(session.instructor.membershipId, session.instructor.displayName);
  }
  const shown = (sessions.data ?? []).filter(
    (session) => instructor === allInstructors || session.instructor?.membershipId === instructor,
  );
  const byDay = (day: IsoDate) =>
    shown.filter((session) => session.localDate === day).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <>
      <header className="tp-row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="tp-eyebrow tp-num">
            {formatDayMonth(week)} עד {formatDate(days[6]!)}
          </span>
          <h1>מערכת שבועית</h1>
        </div>
        <div className={styles.actions}>
          {wide && (
            <Segmented
              label="תצוגה"
              value={view}
              onChange={(next) => show(week, next)}
              options={[
                { value: "week", label: "שבוע" },
                { value: "day", label: "יום" },
              ]}
            />
          )}
          <div role="group" aria-label="מעבר בין שבועות" className={styles.weekNav}>
            <IconButton icon="chevron-right" label="השבוע הקודם" onClick={() => goTo(addDays(week, -7))} />
            <Button variant="secondary" size="sm" onClick={() => goTo(startOfWeek(today))}>
              היום
            </Button>
            <IconButton icon="chevron-left" label="השבוע הבא" onClick={() => goTo(addDays(week, 7))} />
          </div>
          {studio.can("bookings.manage") && (
            <Button variant="secondary" icon="mail" onClick={() => setAnnouncing(true)}>
              הודעה לכל הסטודיו
            </Button>
          )}
          {manage && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              שיעור חדש
            </Button>
          )}
        </div>
      </header>

      {teaching.size > 1 && (
        <FilterChips
          label="סינון לפי מדריך"
          value={instructor}
          onChange={setInstructor}
          options={[
            { value: allInstructors, label: "כל הצוות" },
            ...[...teaching].map(([value, label]) => ({ value, label })),
          ]}
        />
      )}

      {sessions.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(sessions.error, "לא הצלחנו לטעון את מערכת השעות. נסו שוב.")}
        </Banner>
      ) : !sessions.data ? (
        <div aria-busy="true" className="tp-stack">
          <span className="tp-sr-only">טוענים את מערכת השעות…</span>
          <Skeleton height={240} />
        </div>
      ) : sessions.data.length === 0 && manage ? (
        <EmptyState
          icon="calendar"
          title="אין שיעורים בשבוע הזה."
          action={
            <Button variant="secondary" icon="plus" onClick={() => setCreating(true)}>
              שיעור חדש
            </Button>
          }
        >
          שיעור קבוע מופיע בלוח לשמונה השבועות הבאים.
        </EmptyState>
      ) : grid ? (
        <section className={`tp-sched ${styles.grid}`} aria-label="השיעורים לפי ימים">
          <div className="tp-sched__head" aria-hidden="true">
            {days.map((day, index) => (
              <div key={day} className={cx("tp-sched__day", day === today && "tp-sched__day--today")}>
                {weekdayNames[index]} <b>{Number(day.slice(8, 10))}</b>
              </div>
            ))}
          </div>
          <div className="tp-sched__body">
            {days.map((day, index) => {
              const list = byDay(day);
              return (
                <section
                  key={day}
                  className={cx("tp-sched__col", day === today && "tp-sched__col--today")}
                  aria-label={`יום ${weekdayNames[index]} ${formatDate(day)}${day === today ? ", היום" : ""}`}
                >
                  {list.length === 0 ? (
                    <p className="tp-caption tp-muted">אין שיעורים</p>
                  ) : (
                    <DaySessions sessions={list} timeZone={timeZone} />
                  )}
                </section>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="tp-agenda" aria-label="השיעורים לפי ימים">
          <WeekStrip days={days} value={agendaDay} onChange={setPicked} today={today} />
          <h2 className="tp-agenda__day">
            יום {weekdayNames[dayOfWeek(agendaDay)]} · {formatDate(agendaDay)}
            {agendaDay === today && " · היום"}
          </h2>
          {byDay(agendaDay).length === 0 ? (
            <p className="tp-caption tp-muted">אין שיעורים ביום הזה</p>
          ) : (
            <DaySessions sessions={byDay(agendaDay)} timeZone={timeZone} list />
          )}
        </section>
      )}

      {announcing && <AnnouncementDialog onClose={() => setAnnouncing(false)} />}
      {creating && (
        <NewClassDialog
          day={!grid && agendaDay >= today ? agendaDay : week <= today && today <= days[6]! ? today : week}
          today={today}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

/** A day's classes: the held ones, then the cancelled ones folded under one line that opens on a tap (board #494, R-2). */
function DaySessions({ sessions, timeZone, list = false }: { sessions: Session[]; timeZone: string; list?: boolean }) {
  const held = sessions.filter((session) => session.status !== "cancelled");
  const cancelled = sessions.filter((session) => session.status === "cancelled");
  const tiles = (items: Session[]) =>
    list ? (
      <ul className={`tp-agenda__list ${styles.list}`}>
        {items.map((session) => (
          <li key={session.id}>
            <SessionTile session={session} timeZone={timeZone} />
          </li>
        ))}
      </ul>
    ) : (
      items.map((session) => <SessionTile key={session.id} session={session} timeZone={timeZone} />)
    );
  return (
    <>
      {held.length > 0 && tiles(held)}
      {cancelled.length > 0 && (
        <details className={styles.cancelled}>
          <summary>{cancelled.length === 1 ? "שיעור אחד בוטל" : `${cancelled.length} שיעורים בוטלו`}</summary>
          <div className={styles.folded}>{tiles(cancelled)}</div>
        </details>
      )}
    </>
  );
}

function SessionTile({ session, timeZone }: { session: Session; timeZone: string }) {
  const time = clockTime(session.startsAt, timeZone);
  return (
    <EventCard
      to={`sessions/${session.id}`}
      title={session.classType.name}
      color={session.classType.color}
      fill={session.capacity > 0 ? session.bookedCount / session.capacity : 0}
      badge={sessionBadge(session)}
      cancelled={session.status === "cancelled"}
      meta={
        <>
          <span className="tp-num">{time}</span>
          {session.instructor && ` · ${session.instructor.displayName}`}
          <br />
          {session.status === "cancelled" ? "המתאמנים קיבלו הודעה" : occupancy(session)}
        </>
      }
    />
  );
}

import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  Banner,
  Button,
  EmptyState,
  EventCard,
  FilterChips,
  IconButton,
  Skeleton,
  cx,
} from "../../shared/design-system";
import { addDays, formatDate, fromIsoDate, startOfWeek, todayIn, type IsoDate } from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";
import { errorMessage } from "../../api/errors";
import { useStudio } from "../console/studio";
import { NewClassDialog } from "./NewClassDialog";
import { occupancy, sessionBadge, useSessions, useStudioTimeZone, weekdayNames, type Session } from "./queries";

const allInstructors = "all";

/** `/o/:slug/schedule`: the week's classes, Sunday to Saturday on the studio's clock (Schedule mockup). */
export function SchedulePage() {
  const studio = useStudio();
  const timeZone = useStudioTimeZone();
  const today = todayIn(timeZone);
  const [params, setParams] = useSearchParams();
  const asked = params.get("week");
  const week = startOfWeek(asked && fromIsoDate(asked) ? asked : today);
  const days = Array.from({ length: 7 }, (_, offset) => addDays(week, offset));
  const sessions = useSessions(week, days[6]!);
  const [instructor, setInstructor] = useState(allInstructors);
  const [creating, setCreating] = useState(false);
  const manage = studio.can("schedule.manage");

  const goTo = (sunday: IsoDate) => setParams(sunday === startOfWeek(today) ? {} : { week: sunday });

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
            {formatDate(week).slice(0, 5)} עד {formatDate(days[6]!)}
          </span>
          <h1>מערכת שבועית</h1>
        </div>
        <div className="tp-row" style={{ gap: 8 }}>
          <IconButton icon="chevron-right" label="השבוע הקודם" onClick={() => goTo(addDays(week, -7))} />
          <Button variant="secondary" size="sm" onClick={() => goTo(startOfWeek(today))}>
            היום
          </Button>
          <IconButton icon="chevron-left" label="השבוע הבא" onClick={() => goTo(addDays(week, 7))} />
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
      ) : (
        <section className="tp-sched" aria-label="השיעורים לפי ימים">
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
                    list.map((session) => <SessionTile key={session.id} session={session} timeZone={timeZone} />)
                  )}
                </section>
              );
            })}
          </div>
        </section>
      )}

      {creating && (
        <NewClassDialog day={week <= today && today <= days[6]! ? today : week} onClose={() => setCreating(false)} />
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

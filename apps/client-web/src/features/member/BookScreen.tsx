import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Button,
  Chip,
  ClassRow,
  EmptyState,
  FilterChips,
  IconButton,
  shortDate,
  TimeSlot,
  WeekStrip,
} from "../../shared/design-system";
import { addDays, daysBetween, type IsoDate } from "../../shared/utilities/dates";
import { BookingSheet, useBookingFlow } from "./BookingSheet";
import { categoryName, freeSpots, myState, spotsText, waitlistOpen, waitText } from "./bookingState";
import { relativeDay } from "./format";
import styles from "./member.module.css";
import { PassStrip } from "./Passes";
import { metaLine } from "./passText";
import { useBookingPolicy, useSessions, useStudio, useStudioClock, type Session, type Studio } from "./studio";
import { ListSkeleton, LoadError, NoStudio } from "./StudioGate";
import { clockTime, hasStarted, minutesBetween } from "./studioTime";
import { StudioNotices, useBookingPaused } from "./StudioNotices";

const title = "מערכת שיעורים";

export function BookScreen() {
  const studio = useStudio();
  return studio ? <StudioBook studio={studio} /> : <NoStudio title={title} />;
}

function StudioBook({ studio }: { studio: Studio }) {
  const { timeZone, now, today } = useStudioClock(studio.id);
  const policy = useBookingPolicy(studio.id);
  const paused = useBookingPaused();
  const [params] = useSearchParams();

  // The timetable is open from today to the booking horizon, a week of the strip at a time.
  const weeks = Math.max(1, Math.ceil((policy.data?.bookingHorizonDays ?? 14) / 7));
  const asked = params.get("day");
  const [day, setDay] = useState<IsoDate>(() => {
    const offset = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? daysBetween(today, asked) : -1;
    return asked && offset >= 0 && offset < weeks * 7 ? asked : today;
  });
  const [category, setCategory] = useState("all");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const flow = useBookingFlow(studio.id);
  // After booking, the pressed button turns into a chip: focus moves to that class's link in the list.
  const list = useRef<HTMLUListElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (focusId) list.current?.querySelector<HTMLAnchorElement>(`a[href="/classes/${focusId}"]`)?.focus();
  }, [focusId]);
  const pick = (sessionId: string | null) => {
    flow.reset();
    setPickedId(sessionId);
  };

  const week = Math.min(Math.max(Math.floor(daysBetween(today, day) / 7), 0), weeks - 1);
  const from = addDays(today, week * 7);
  const days = Array.from({ length: 7 }, (_, offset) => addDays(from, offset));
  const sessions = useSessions(studio.id, from, addDays(from, 6));

  const all = sessions.data ?? [];
  const categories = [...new Set(all.map((session) => session.classType.category))];
  const filters = [
    { value: "all", label: "הכל" },
    ...categories.map((value) => ({ value, label: categoryName(value, all) })),
  ];
  const rows = all
    .filter((session) => session.localDate === day && !hasStarted(session.endsAt, now))
    .filter((session) => category === "all" || session.classType.category === category);
  const picked = all.find((session) => session.id === pickedId) ?? null;

  function action(session: Session) {
    const time = clockTime(session.startsAt, timeZone);
    const name = `לשיעור ${session.classType.name} ב-${time}`;
    if (session.status === "cancelled") return <Chip plain>השיעור בוטל</Chip>;
    switch (myState(session, now)) {
      case "booked":
      case "attended":
        return <Chip tone="success">נרשמת</Chip>;
      case "no_show":
        return <Chip tone="warning">לא הגעת</Chip>;
      case "waitlisted":
        return <Chip tone="warning">{waitText(session.myBooking?.waitlistPosition)}</Chip>;
      case "expired":
        return <Chip plain>לא התפנה מקום</Chip>;
      default:
    }
    if (hasStarted(session.startsAt, now)) return <Chip plain>השיעור התחיל</Chip>;
    if (freeSpots(session) > 0) {
      return (
        <Button
          variant="secondary"
          size="sm"
          aria-label={`הרשמה ${name}`}
          loading={flow.pendingId === session.id}
          disabled={paused}
          onClick={() => pick(session.id)}
        >
          הרשמה
        </Button>
      );
    }
    if (waitlistOpen(session, policy.data, now)) {
      return (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`להמתנה ${name}`}
          loading={flow.pendingId === session.id}
          disabled={paused}
          onClick={() => pick(session.id)}
        >
          להמתנה
        </Button>
      );
    }
    return <Chip plain>מלא</Chip>;
  }

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen} ${styles.narrow}`}>
      <header className={styles.heading}>
        <span className="tp-eyebrow">{studio.name}</span>
        <h1 className={styles.title}>{title}</h1>
      </header>
      <StudioNotices />
      <PassStrip organizationId={studio.id} />

      <div className={styles.group}>
        <div className={styles.sectionHead}>
          <span className="tp-label tp-muted">
            {week === 0 ? "השבוע הקרוב" : `החל מ${relativeDay(from, today)} ${shortDate(from)}`}
          </span>
          <div className={styles.weekButtons}>
            <IconButton
              icon="chevron-right"
              size="sm"
              label="השבוע הקודם"
              disabled={week === 0}
              onClick={() => setDay(addDays(from, -7))}
            />
            <IconButton
              icon="chevron-left"
              size="sm"
              label="השבוע הבא"
              disabled={week >= weeks - 1}
              onClick={() => setDay(addDays(from, 7))}
            />
          </div>
        </div>
        <WeekStrip days={days} value={day} onChange={setDay} today={today} />
      </div>
      {categories.length > 1 && (
        <FilterChips label="סוג שיעור" options={filters} value={category} onChange={setCategory} />
      )}

      {sessions.isPending ? (
        <ListSkeleton />
      ) : sessions.isError ? (
        <LoadError error={sessions.error} onRetry={() => void sessions.refetch()}>
          לא הצלחנו לטעון את מערכת השיעורים
        </LoadError>
      ) : rows.length === 0 ? (
        <EmptyState icon="calendar" title={day === today ? "אין עוד שיעורים היום" : "אין שיעורים ביום הזה"} />
      ) : (
        <ul ref={list} className={styles.list} aria-label={`שיעורים, ${relativeDay(day, today)}`}>
          {rows.map((session) => (
            <ClassRow
              key={session.id}
              as="li"
              to={`/classes/${session.id}`}
              slot={
                <TimeSlot time={clockTime(session.startsAt, timeZone)}>
                  {minutesBetween(session.startsAt, session.endsAt)} דק׳
                </TimeSlot>
              }
              title={session.classType.name}
              meta={metaLine([
                session.instructor?.displayName,
                session.status === "cancelled" ? null : spotsText(session),
              ])}
              actions={action(session)}
            />
          ))}
        </ul>
      )}

      <BookingSheet
        session={picked}
        timeZone={timeZone}
        today={today}
        policy={policy.data}
        now={now}
        pending={flow.pendingId !== undefined}
        error={flow.error}
        onConfirm={(session) =>
          flow.run(session, () => {
            setPickedId(null);
            setFocusId(session.id);
          })
        }
        onClose={() => pick(null)}
      />
    </main>
  );
}

import { useState } from "react";
import { Link } from "react-router";
import {
  ButtonLink,
  Card,
  EmptyState,
  EventCard,
  Icon,
  IconButton,
  ProgressRing,
  Skeleton,
  WeekStrip,
  shortDate,
  useToast,
} from "../../shared/design-system";
import { activeMemberships, nameOf, useAccount } from "../../account/account";
import { addDays, dayOfWeek, startOfWeek } from "../../shared/utilities/dates";
import { bookingFor, freeSpots, useBookings, useClasses, useProfile, useToday } from "./data";
import { dayName, relativeDay } from "./format";
import styles from "./member.module.css";
import type { Booking, StudioClass } from "./sample";
import { StudioNotices } from "./StudioNotices";

function badge(item: StudioClass, booking: Booking | undefined): string {
  if (booking?.status === "booked") return "נרשמת";
  if (booking?.status === "waiting") return `במקום ${booking.position} בהמתנה`;
  const free = freeSpots(item);
  return free === 0 ? "מלא · המתנה" : free === 1 ? "מקום אחד" : `${free} מקומות`;
}

export function HomeScreen() {
  const today = useToday();
  const toast = useToast();
  const classes = useClasses();
  const bookings = useBookings();
  const profile = useProfile();
  const me = useAccount();
  const [day, setDay] = useState(today);
  const week = Array.from({ length: 7 }, (_, offset) => addDays(startOfWeek(today), offset));

  if (!classes.data || !bookings.data || !profile.data) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy="true">
        <Skeleton height={56} />
        <Skeleton height={160} />
        <Skeleton height={240} />
      </main>
    );
  }

  // The greeting and the studio are the account's; the classes, the goal and the streak stay sample data.
  const member = profile.data;
  const studio = activeMemberships(me)[0]?.organization.displayName;
  const firstName = nameOf(me).split(" ")[0];
  const next = classes.data
    .filter((item) => bookingFor(bookings.data, item.id)?.status === "booked")
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))[0];
  const dayClasses = classes.data.filter((item) => item.date === day);
  const dayTitle =
    day === today ? "השיעורים של היום" : day === addDays(today, 1) ? "השיעורים של מחר" : `השיעורים של ${dayName(day)}`;
  const emptyText =
    day < today ? "היום הזה כבר עבר" : dayOfWeek(day) === 6 ? "אין שיעורים בשבת" : "אין שיעורים ביום הזה";

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className="tp-eyebrow">
            {dayName(today)} · {shortDate(today)}
            {studio && <> · {studio}</>}
          </span>
          <h1 className={styles.title}>היי {firstName}</h1>
        </div>
        <IconButton icon="bell" label="התראות" onClick={() => toast.show({ message: "אין התראות חדשות" })} />
      </header>
      <StudioNotices />

      {next ? (
        <Card as="section" tone="elevated" className={styles.next} aria-labelledby="next-class">
          <span className="tp-eyebrow">השיעור הבא שלך</span>
          <h2 id="next-class" className={styles.nextTitle}>
            {next.title}
          </h2>
          <span>
            {relativeDay(next.date, today)} {next.start} · {next.coach} · {next.room}
          </span>
          <div className={styles.nextActions}>
            <ButtonLink to="/bookings" variant="rose">
              להזמנות שלי
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <Card as="section" tone="elevated" className={styles.next} aria-labelledby="next-class">
          <h2 id="next-class" className={styles.nextTitle}>
            אין לך שיעור קרוב
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
        {dayClasses.length > 0 && day >= today ? (
          <ul className={styles.list}>
            {dayClasses.map((item) => (
              <li key={item.id}>
                <EventCard
                  to={`/book?day=${item.date}`}
                  title={item.title}
                  meta={`${item.start} · ${item.coach}`}
                  color={item.color}
                  fill={item.booked / item.capacity}
                  badge={badge(item, bookingFor(bookings.data, item.id))}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="calendar" title={emptyText} />
        )}
      </section>

      <section aria-label="ההתקדמות שלך" className={styles.stats}>
        <Card small className={styles.stat}>
          <ProgressRing
            size="sm"
            value={member.visitsThisMonth}
            max={member.monthlyGoal}
            label={`ביקורים החודש, מתוך יעד של ${member.monthlyGoal}`}
          >
            {member.visitsThisMonth}
          </ProgressRing>
          <span className="tp-stat__label">ביקורים החודש</span>
        </Card>
        <Card small tone="base" className={styles.stat}>
          <span className="tp-icon-tile tp-icon-tile--sm">
            <Icon name="check" />
          </span>
          <span className="tp-stat__label">{member.streakWeeks} שבועות ברצף עם שלושה שיעורים</span>
        </Card>
      </section>
    </main>
  );
}

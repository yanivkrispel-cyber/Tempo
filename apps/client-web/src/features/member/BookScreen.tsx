import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  Button,
  Chip,
  ClassRow,
  Dialog,
  EmptyState,
  FilterChips,
  Icon,
  Segmented,
  Skeleton,
  TimeSlot,
  useToast,
} from "../../shared/design-system";
import { addDays } from "../../shared/utilities/dates";
import {
  bookingFor,
  freeSpots,
  spotsText,
  useBook,
  useBookings,
  useClasses,
  useJoinWaitlist,
  useProfile,
  useToday,
} from "./data";
import { relativeDay, shortDayName } from "./format";
import styles from "./member.module.css";
import type { ClassKind, StudioClass } from "./sample";

type Filter = "all" | ClassKind;

const filters: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "הכל" },
  { value: "pilates", label: "פילאטיס" },
  { value: "yoga", label: "יוגה" },
];

export function BookScreen() {
  const today = useToday();
  const toast = useToast();
  const classes = useClasses();
  const bookings = useBookings();
  const profile = useProfile();
  const book = useBook();
  const joinWaitlist = useJoinWaitlist();
  const [params] = useSearchParams();

  const days = Array.from({ length: 4 }, (_, offset) => addDays(today, offset));
  const asked = params.get("day");
  const [day, setDay] = useState(asked && days.includes(asked) ? asked : today);
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<StudioClass | null>(null);

  if (!classes.data || !bookings.data || !profile.data) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy="true">
        <Skeleton height={56} />
        <Skeleton height={300} />
      </main>
    );
  }

  const rows = classes.data.filter((item) => item.date === day && (filter === "all" || item.kind === filter));
  const dayOptions = days.map((value) => ({
    value,
    label: value === today || value === addDays(today, 1) ? relativeDay(value, today) : shortDayName(value),
  }));

  function confirm(item: StudioClass) {
    book.mutate(item.id, {
      onSuccess: () => {
        setPicked(null);
        toast.show({ tone: "success", message: "נרשמת לשיעור. תזכורת תגיע שעתיים לפני." });
      },
      onError: () => toast.show({ tone: "danger", message: "ההרשמה לא הצליחה. נסו שוב." }),
    });
  }

  function wait(item: StudioClass) {
    joinWaitlist.mutate(item.id, {
      onSuccess: () => toast.show({ tone: "success", message: "נכנסת לרשימת ההמתנה. נודיע לך כשיתפנה מקום." }),
      onError: () => toast.show({ tone: "danger", message: "ההצטרפות לרשימת ההמתנה לא הצליחה. נסו שוב." }),
    });
  }

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
      <header className={styles.heading}>
        <span className="tp-eyebrow">{profile.data.studio.name}</span>
        <h1 className={styles.title}>מערכת שיעורים</h1>
      </header>

      <Segmented label="יום" block options={dayOptions} value={day} onChange={setDay} />
      <FilterChips label="סוג שיעור" options={filters} value={filter} onChange={setFilter} />

      {rows.length === 0 ? (
        <EmptyState icon="calendar" title="אין שיעורים ביום הזה" />
      ) : (
        <ul className={styles.list} aria-label={`שיעורים, ${relativeDay(day, today)}`}>
          {rows.map((item) => {
            const booking = bookingFor(bookings.data, item.id);
            const name = `${item.title} ב-${item.start}`;
            return (
              <ClassRow
                key={item.id}
                as="li"
                slot={<TimeSlot time={item.start}>{item.minutes} דק׳</TimeSlot>}
                title={item.title}
                meta={
                  booking?.status === "booked" ? `${item.coach} · נרשמת לשיעור` : `${item.coach} · ${spotsText(item)}`
                }
                actions={
                  booking?.status === "booked" ? (
                    <Chip tone="success">נרשמת</Chip>
                  ) : booking?.status === "waiting" ? (
                    <Chip tone="warning">במקום {booking.position} בהמתנה</Chip>
                  ) : freeSpots(item) > 0 ? (
                    <Button variant="secondary" size="sm" aria-label={`הרשמה ל${name}`} onClick={() => setPicked(item)}>
                      הרשמה
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`להמתנה ל${name}`}
                      loading={joinWaitlist.isPending && joinWaitlist.variables === item.id}
                      onClick={() => wait(item)}
                    >
                      להמתנה
                    </Button>
                  )
                }
              />
            );
          })}
        </ul>
      )}

      <Dialog open={picked !== null} onClose={() => setPicked(null)} title={picked ? `הרשמה ל${picked.title}` : ""}>
        {picked && (
          <>
            <div className={styles.sheetDetails}>
              <div className={styles.sheetDetail}>
                <span className="tp-icon-tile tp-icon-tile--sm">
                  <Icon name="calendar" />
                </span>
                <span>
                  {relativeDay(picked.date, today)} · {picked.start} · {picked.minutes} דק׳
                </span>
              </div>
              <div className={styles.sheetDetail}>
                <span className="tp-icon-tile tp-icon-tile--sm">
                  <Icon name="user" />
                </span>
                <span>עם {picked.coach}</span>
              </div>
              <div className={styles.sheetDetail}>
                <span className="tp-icon-tile tp-icon-tile--sm">
                  <Icon name="credit-card" />
                </span>
                <span>כלול במנוי החודשי שלך</span>
              </div>
            </div>
            <p className={`tp-caption ${styles.sheetNote}`}>ביטול חינם עד 4 שעות לפני תחילת השיעור.</p>
            <div className={styles.sheetActions}>
              <Button size="lg" block loading={book.isPending} onClick={() => confirm(picked)}>
                אישור ההרשמה
              </Button>
              <Button variant="ghost" block onClick={() => setPicked(null)}>
                לא עכשיו
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </main>
  );
}

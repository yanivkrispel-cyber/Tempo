import { useState } from "react";
import { Banner, ButtonLink, Chip, ClassRow, EmptyState, Skeleton, Tabs, TimeSlot, shortDate } from "../../shared/design-system";
import { bookingFor, useBookings, useClasses, useHistory, useProfile, useToday } from "./data";
import { relativeDay, shortDayName } from "./format";
import styles from "./member.module.css";

type View = "upcoming" | "history";

export function BookingsScreen() {
  const today = useToday();
  const classes = useClasses();
  const bookings = useBookings();
  const history = useHistory();
  const profile = useProfile();
  const [view, setView] = useState<View>("upcoming");

  if (!classes.data || !bookings.data || !history.data || !profile.data) {
    return (
      <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy="true">
        <Skeleton height={56} />
        <Skeleton height={300} />
      </main>
    );
  }

  const upcoming = classes.data
    .filter((item) => bookingFor(bookings.data, item.id))
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
      <header className={styles.heading}>
        <span className="tp-eyebrow">{profile.data.name}</span>
        <h1 className={styles.title}>ההזמנות שלי</h1>
      </header>

      <Tabs
        label="הזמנות"
        value={view}
        onChange={setView}
        tabs={[
          { value: "upcoming", label: `קרובים · ${upcoming.length}` },
          { value: "history", label: "היסטוריה" }
        ]}
      >
        {view === "upcoming" ? (
          <div className={styles.group}>
            {upcoming.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="אין לך הזמנות קרובות"
                action={
                  <ButtonLink to="/book" variant="secondary">
                    למערכת השיעורים
                  </ButtonLink>
                }
              />
            ) : (
              <ul className={styles.list} aria-label="הזמנות קרובות">
                {upcoming.map((item) => {
                  const booking = bookingFor(bookings.data, item.id);
                  const day = item.date === today ? "היום" : shortDayName(item.date);
                  return (
                    <ClassRow
                      key={item.id}
                      as="li"
                      slot={<TimeSlot time={item.start}>{day}</TimeSlot>}
                      title={item.title}
                      meta={`${relativeDay(item.date, today)} · ${item.coach} · ${item.room}`}
                      actions={
                        booking?.status === "waiting" ? (
                          <Chip tone="warning">במקום {booking.position} בהמתנה</Chip>
                        ) : (
                          <Chip tone="success">נרשמת</Chip>
                        )
                      }
                    />
                  );
                })}
              </ul>
            )}
            <Banner icon="info" role="note">
              כשמתפנה מקום בשיעור שברשימת ההמתנה שלך, נרשום אותך אוטומטית ונשלח התראה.
            </Banner>
          </div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table tp-table--compact">
              <caption className="tp-sr-only">שיעורים קודמים</caption>
              <thead>
                <tr>
                  <th scope="col">שיעור</th>
                  <th scope="col">תאריך</th>
                  <th scope="col">מצב</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((visit) => (
                  <tr key={visit.id}>
                    <td>{visit.title}</td>
                    <td className="tp-muted">{shortDate(visit.date)}</td>
                    <td>
                      {visit.status === "attended" ? (
                        <Chip tone="success">הגעת</Chip>
                      ) : (
                        <Chip plain>בוטל בזמן</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tabs>
    </main>
  );
}

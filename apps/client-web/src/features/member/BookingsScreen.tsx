import { useState } from "react";
import {
  Banner,
  Button,
  ButtonLink,
  Chip,
  ClassRow,
  EmptyState,
  shortDate,
  TableScroll,
  Tabs,
  TimeSlot,
} from "../../shared/design-system";
import { nameOf, useAccount } from "../../account/account";
import { pastStatus, waitText } from "./bookingState";
import { relativeDay, shortDayName } from "./format";
import styles from "./member.module.css";
import { metaLine } from "./passText";
import {
  useInbox,
  usePastBookings,
  useStudio,
  useStudioClock,
  useUpcomingBookings,
  type MyBooking,
  type Studio,
} from "./studio";
import { ListSkeleton, LoadError, NoStudio } from "./StudioGate";
import { clockTime, studioDate } from "./studioTime";
import { StudioNotices } from "./StudioNotices";

type View = "upcoming" | "history";

const title = "ההזמנות שלי";

export function BookingsScreen() {
  const studio = useStudio();
  return studio ? <StudioBookings studio={studio} /> : <NoStudio title={title} />;
}

function StudioBookings({ studio }: { studio: Studio }) {
  const me = useAccount();
  const { timeZone, now, today } = useStudioClock(studio.id);
  const [view, setView] = useState<View>("upcoming");
  const upcoming = useUpcomingBookings(studio.id);
  const past = usePastBookings(studio.id, view === "history");

  const inbox = useInbox(studio.id);
  const count = upcoming.data?.length;
  const promoted = new Set(
    (inbox.data?.items ?? []).filter((item) => item.kind === "booking.promoted").map((item) => item.data.bookingId),
  );
  const waiting = upcoming.data?.some((booking) => booking.status === "waitlisted") ?? false;

  function upcomingRow(booking: MyBooking) {
    const session = booking.session;
    const day = session.localDate === today ? "היום" : shortDayName(session.localDate);
    return (
      <ClassRow
        key={booking.id}
        as="li"
        to={`/classes/${session.id}`}
        slot={<TimeSlot time={clockTime(session.startsAt, timeZone)}>{day}</TimeSlot>}
        title={session.classType.name}
        meta={metaLine([relativeDay(session.localDate, today), session.instructor?.displayName, session.room?.name])}
        actions={
          booking.status === "waitlisted" ? (
            <Chip tone="warning">{waitText(booking.waitlistPosition)}</Chip>
          ) : promoted.has(booking.id) ? (
            <Chip tone="success">נרשמת מההמתנה</Chip>
          ) : (
            <Chip tone="success">נרשמת</Chip>
          )
        }
      />
    );
  }

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`}>
      <header className={styles.heading}>
        <span className="tp-eyebrow">{nameOf(me)}</span>
        <h1 className={styles.title}>{title}</h1>
      </header>
      <StudioNotices />

      <Tabs
        block
        label="הזמנות"
        value={view}
        onChange={setView}
        tabs={[
          { value: "upcoming", label: count === undefined ? "קרובים" : `קרובים · ${count}` },
          { value: "history", label: "היסטוריה" },
        ]}
      >
        {view === "upcoming" ? (
          <div className={styles.group}>
            {upcoming.isPending ? (
              <ListSkeleton />
            ) : upcoming.isError ? (
              <LoadError error={upcoming.error} onRetry={() => void upcoming.refetch()} />
            ) : upcoming.data.length === 0 ? (
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
                {upcoming.data.map(upcomingRow)}
              </ul>
            )}
            {waiting && (
              <Banner icon="bell" role="note">
                כשמתפנה מקום בשיעור שברשימת ההמתנה שלך, נרשום אותך אוטומטית ונשלח התראה.
              </Banner>
            )}
          </div>
        ) : past.isPending ? (
          <ListSkeleton />
        ) : past.isError ? (
          <LoadError error={past.error} onRetry={() => void past.refetch()} />
        ) : past.data.pages[0]?.items.length === 0 ? (
          <EmptyState icon="list" title="עוד אין שיעורים קודמים" />
        ) : (
          <div className={styles.group}>
            <TableScroll label="שיעורים קודמים">
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
                  {past.data.pages
                    .flatMap((page) => page.items)
                    .map((booking) => {
                      const status = pastStatus(booking, booking.session, now);
                      return (
                        <tr key={booking.id}>
                          <td>{booking.session.classType.name}</td>
                          <td className="tp-muted">{shortDate(studioDate(booking.session.startsAt, timeZone))}</td>
                          <td>
                            <Chip tone={status.tone} plain={status.plain}>
                              {status.label}
                            </Chip>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </TableScroll>
            {past.hasNextPage && (
              <Button variant="ghost" block loading={past.isFetchingNextPage} onClick={() => void past.fetchNextPage()}>
                עוד שיעורים קודמים
              </Button>
            )}
          </div>
        )}
      </Tabs>
    </main>
  );
}

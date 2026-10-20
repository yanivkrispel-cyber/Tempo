import { useState } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { useMe } from "../../account/account";
import { NotFoundPage } from "../../app/NotFoundPage";
import { useStudioPath } from "../../app/studioPath";
import { useAuth } from "../../auth/AuthProvider";
import { Button, Card, IconButtonLink, shortDate } from "../../shared/design-system";
import { addDays, daysBetween, fromIsoDate, startOfWeek, type IsoDate } from "../../shared/utilities/dates";
import { useNow } from "../member/clock";
import { relativeDay } from "../member/format";
import { ListSkeleton, LoadError } from "../member/StudioGate";
import { defaultTimeZone, hasStarted, studioDate, studioToday } from "../member/studioTime";
import { PublicFrame, PublicSkeleton, StudioNotFound } from "./PublicFrame";
import {
  isMemberOf,
  isNotFound,
  usePublicSessions,
  usePublicStudio,
  type PublicSession,
  type PublicStudio,
} from "./publicStudio";
import { PublicSessionRow } from "./PublicSessionRow";
import { offerText } from "./publicText";
import { ReserveSheet } from "./ReserveSheet";
import styles from "./public.module.css";

/** How far ahead the public week goes (PublicStudioReads.MaxDaysAhead). */
const weeksAhead = 8;

/**
 * The studio's public page, `/s/<slug>/` for a visitor and `/s/<slug>/week/<yyyy-mm-dd>` for the week from that
 * Sunday (docs/37 section 4.1): the cover, logo and name, the intro offer, the week's classes by day, and joining.
 */
export function PublicStudioPage() {
  const slug = useStudioPath();
  if (!slug) return <NotFoundPage />;
  return <PublicStudio slug={slug} />;
}

/** `/week/<date>`: a member sees the same week in the member app's timetable. */
export function PublicWeekPage() {
  const slug = useStudioPath();
  const { date = "" } = useParams();
  const { isSignedIn } = useAuth();
  const me = useMe();
  if (!slug || !fromIsoDate(date)) return <NotFoundPage />;
  if (isSignedIn && me.isPending) return <PublicSkeleton />;
  if (me.data && isMemberOf(me.data, slug)) return <Navigate to={`/book?day=${date}`} replace />;
  return <PublicStudio slug={slug} week={startOfWeek(date)} />;
}

function PublicStudio({ slug, week }: { slug: string; week?: IsoDate }) {
  const studio = usePublicStudio(slug);
  if (studio.isPending) return <PublicSkeleton />;
  if (studio.isError) {
    return isNotFound(studio.error) ? (
      <StudioNotFound />
    ) : (
      <PublicFrame studio={null}>
        <LoadError error={studio.error} onRetry={() => void studio.refetch()} />
      </PublicFrame>
    );
  }
  return <StudioView studio={studio.data} week={week} />;
}

function StudioView({ studio, week }: { studio: PublicStudio; week?: IsoDate }) {
  const now = useNow();
  const timeZone = studio.timeZone || defaultTimeZone;
  const today = studioToday(timeZone, now);
  const location = useLocation();
  // Back from signing in with `?reserve=1`: the join sheet opens again.
  const [joining, setJoining] = useState(() => new URLSearchParams(location.search).has("reserve"));

  const thisWeek = startOfWeek(today);
  const first = week ?? thisWeek;
  const ahead = Math.floor(daysBetween(thisWeek, first) / 7);
  // The API reads from today on, so a week already over goes back to this one.
  if (ahead < 0 || ahead > weeksAhead) return <Navigate to="/" replace />;
  const from = first < today ? today : first;
  const to = addDays(first, 6);

  return (
    <PublicFrame studio={studio}>
      <section className={`tp-hero ${styles.studioHero}`} aria-labelledby="public-studio-title">
        {studio.coverUrl && <img className="tp-hero__photo" src={studio.coverUrl} alt="" />}
        <div className="tp-hero__body">
          <div className="tp-hero__text">
            <span className={styles.when}>מערכת השיעורים</span>
            <h1 id="public-studio-title" className="tp-hero__title">
              <bdi>{studio.name}</bdi>
            </h1>
          </div>
        </div>
      </section>

      {studio.introOffer && (
        <Card className={styles.offer}>
          <span className="tp-label tp-muted">פעם ראשונה בסטודיו?</span>
          <strong>{offerText(studio.introOffer)}</strong>
          <span className="tp-muted">נרשמים כאן, משלמים בסטודיו.</span>
        </Card>
      )}

      <section className={styles.section} aria-labelledby="public-week">
        <div className={styles.sectionHead}>
          <h2 id="public-week" className={styles.sectionTitle}>
            {ahead === 0 ? "השבוע" : `השבוע של ${shortDate(first)}`}
          </h2>
          <div className={styles.weekButtons}>
            {ahead > 0 && (
              <IconButtonLink
                icon="chevron-right"
                size="sm"
                label="השבוע הקודם"
                to={ahead === 1 ? "/" : `/week/${addDays(first, -7)}`}
              />
            )}
            {ahead < weeksAhead && (
              <IconButtonLink icon="chevron-left" size="sm" label="השבוע הבא" to={`/week/${addDays(first, 7)}`} />
            )}
          </div>
        </div>
        <Week studio={studio} from={from} to={to} today={today} now={now} />
      </section>

      {studio.openJoin && (
        <div className={styles.actions}>
          <Button size="lg" block onClick={() => setJoining(true)}>
            הצטרפות לסטודיו
          </Button>
        </div>
      )}
      <ReserveSheet
        open={joining}
        onClose={() => setJoining(false)}
        studio={studio}
        title={`הצטרפות ל${studio.name}`}
        returnTo="/"
      />
    </PublicFrame>
  );
}

/** The week's classes that have not started, by day. */
function Week({
  studio,
  from,
  to,
  today,
  now,
}: {
  studio: PublicStudio;
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  now: Date;
}) {
  const sessions = usePublicSessions(studio.slug, from, to);
  const timeZone = studio.timeZone || defaultTimeZone;
  if (sessions.isPending) return <ListSkeleton />;
  if (sessions.isError) {
    return (
      <LoadError error={sessions.error} onRetry={() => void sessions.refetch()}>
        לא הצלחנו לטעון את מערכת השיעורים
      </LoadError>
    );
  }
  const days = new Map<IsoDate, PublicSession[]>();
  for (const session of sessions.data) {
    if (hasStarted(session.startsAt, now)) continue;
    const date = studioDate(session.startsAt, timeZone);
    days.set(date, [...(days.get(date) ?? []), session]);
  }
  if (days.size === 0) return <p className="tp-muted">אין שיעורים פתוחים בשבוע הזה.</p>;
  return (
    <>
      {[...days].map(([date, list]) => (
        <div key={date} className={styles.day}>
          <h3 className={styles.dayTitle}>
            {relativeDay(date, today)} · {shortDate(date)}
          </h3>
          <ul className={styles.list}>
            {list.map((session) => (
              <PublicSessionRow key={session.id} session={session} timeZone={timeZone} now={now} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

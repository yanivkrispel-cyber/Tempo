import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { errorMessage, isNotFound } from "../../api/errors";
import { Banner, Button, ButtonLink, Chip, IconButtonLink, ProgressBar, Skeleton } from "../../shared/design-system";
import { StudioClock } from "../../shared/studio/StudioClock";
import { clockTime } from "../../shared/utilities/times";
import { useStudio } from "../console/studio";
import styles from "./live.module.css";
import { LiveRoom, ScanDialog } from "./LiveRoom";
import { useSession, type Session } from "./queries";

const minute = 60_000;

/** "12:40": minutes and seconds since the start, or "0:00" before it. */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * OwnerLive (LV-1, #378 item 2, OwnerLive.dc.html): the class while it runs, on a screen of its own. The clock
 * against the class length, who came in out of who booked, the room as a map or a list, and the door scan always at
 * hand. Built on the live room's own data; the staff who may open the session page may open this one.
 */
export function OwnerLivePage() {
  const { sessionId = "" } = useParams();
  const studio = useStudio();
  const session = useSession(sessionId);

  if (session.isError) {
    return (
      <div className="tp-stack">
        <Banner tone="danger" icon="info">
          {isNotFound(session.error)
            ? "השיעור לא נמצא."
            : errorMessage(session.error, "לא הצלחנו לטעון את השיעור. נסו שוב.")}
        </Banner>
        <ButtonLink to={`/o/${studio.slug}/today`} variant="secondary">
          להיום בסטודיו
        </ButtonLink>
      </div>
    );
  }
  if (!session.data) {
    return (
      <div aria-busy="true" className="tp-stack">
        <span className="tp-sr-only">טוענים את השיעור…</span>
        <Skeleton height={96} />
        <Skeleton height={320} />
      </div>
    );
  }
  const data = session.data;
  return <StudioClock>{(timeZone) => <Live session={data} timeZone={timeZone} />}</StudioClock>;
}

function Live({ session, timeZone }: { session: Session; timeZone: string }) {
  const studio = useStudio();
  const [now, setNow] = useState(() => Date.now());
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const starts = new Date(session.startsAt).getTime();
  const ends = new Date(session.endsAt).getTime();
  const length = Math.round((ends - starts) / minute);
  const instructor = session.instructor?.membershipId === studio.membership.membershipId;
  const cancelled = session.status === "cancelled";
  const spotRoom = session.room?.spotSelection === true;
  // A room without spots has no map; its door scan is still here, in the same window as on the session page (D19).
  const canScan =
    (studio.can("attendance.mark") || instructor) && !cancelled && now >= starts - 30 * minute && now <= ends;
  const state = cancelled
    ? { tone: "danger" as const, text: "השיעור בוטל" }
    : now < starts
      ? { tone: "neutral" as const, text: `מתחיל בעוד ${Math.max(1, Math.ceil((starts - now) / minute))} דק׳` }
      : now <= ends
        ? { tone: "success" as const, text: "בשיעור עכשיו" }
        : { tone: "neutral" as const, text: "השיעור הסתיים" };
  const meta = [clockTime(session.startsAt, timeZone), session.instructor && `עם ${session.instructor.displayName}`]
    .concat(session.room?.name ?? [])
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <IconButtonLink
          to={`/o/${studio.slug}/schedule/sessions/${session.id}`}
          icon="chevron-right"
          label="לפרטי השיעור"
        />
        <Chip tone={state.tone}>
          {state.tone === "success" && <span className="tp-live tp-live--sage" aria-hidden="true" />}
          {state.text}
        </Chip>
      </div>
      <header className={styles.head}>
        <div className="tp-stack" style={{ gap: 4, minWidth: 0 }}>
          <h1>
            <bdi>{session.classType.name}</bdi>
          </h1>
          <span className="tp-caption">
            <bdi>{meta}</bdi>
          </span>
        </div>
        <div className={styles.clock}>
          <strong className="tp-num" dir="ltr" role="timer" aria-label="זמן מתחילת השיעור">
            {elapsedText(Math.min(now, ends) - starts)}
          </strong>
          <span className="tp-caption tp-num">מתוך {length} דקות</span>
        </div>
      </header>
      <ProgressBar
        value={Math.min(Math.max(now - starts, 0), ends - starts)}
        max={ends - starts}
        label="התקדמות השיעור"
        tone="sage"
      />
      {spotRoom ? (
        <LiveRoom session={session} layout="page" />
      ) : (
        <>
          <Banner tone="info" icon="info">
            לחדר הזה אין מפת מכשירים. את הרשומים רואים בפרטי השיעור.
          </Banner>
          {canScan && (
            <div className={styles.scanBar}>
              <Button size="lg" block icon="qr" onClick={() => setScanning(true)}>
                סריקת כרטיס כניסה
              </Button>
            </div>
          )}
        </>
      )}
      {scanning && <ScanDialog session={session} onClose={() => setScanning(false)} />}
    </div>
  );
}

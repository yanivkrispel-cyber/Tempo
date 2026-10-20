import { useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { useMe } from "../../account/account";
import { NotFoundPage } from "../../app/NotFoundPage";
import { useStudioPath } from "../../app/studioPath";
import { useAuth } from "../../auth/AuthProvider";
import { Avatar, Button, ButtonLink, Chip, EmptyState, Icon, Skeleton } from "../../shared/design-system";
import { addDays, type IsoDate } from "../../shared/utilities/dates";
import { useNow } from "../member/clock";
import { LoadError } from "../member/StudioGate";
import { clockTime, defaultTimeZone, studioToday } from "../member/studioTime";
import { PublicFrame, PublicSkeleton, StudioNotFound } from "./PublicFrame";
import {
  isMemberOf,
  isNotFound,
  publicRangeDays,
  usePublicSession,
  usePublicSessions,
  usePublicStudio,
  type PublicSession,
  type PublicStudio,
} from "./publicStudio";
import {
  alternatives,
  availabilityChip,
  closedChip,
  dateLine,
  offerText,
  publicState,
  roomChip,
  shortWhen,
  slotMeta,
  type PublicClassState,
} from "./publicText";
import { ReserveSheet } from "./ReserveSheet";
import styles from "./public.module.css";

/**
 * A class's public page, `/s/<slug>/c/<sessionId>` (docs/37 section 4.1, SL-2, board א). A member of the studio goes
 * straight to the member app's class screen with the booking sheet open; anyone else sees the class and reserves a
 * place from a sheet on the same address.
 */
export function PublicClassPage() {
  const slug = useStudioPath();
  const { sessionId = "" } = useParams();
  if (!slug) return <NotFoundPage />;
  return <MemberOrVisitor slug={slug} sessionId={sessionId} />;
}

function MemberOrVisitor({ slug, sessionId }: { slug: string; sessionId: string }) {
  const { isSignedIn } = useAuth();
  const me = useMe();
  if (isSignedIn && me.isPending) return <PublicSkeleton />;
  if (me.data && isMemberOf(me.data, slug)) return <Navigate to={`/classes/${sessionId}?book=1`} replace />;
  return <PublicClass slug={slug} sessionId={sessionId} />;
}

function PublicClass({ slug, sessionId }: { slug: string; sessionId: string }) {
  const studio = usePublicStudio(slug);
  const session = usePublicSession(slug, sessionId);
  const now = useNow();
  if (studio.isPending || session.isPending) return <PublicSkeleton />;
  if (studio.isError) {
    return isNotFound(studio.error) ? (
      <StudioNotFound />
    ) : (
      <PublicFrame studio={null}>
        <LoadError error={studio.error} onRetry={() => void studio.refetch()} />
      </PublicFrame>
    );
  }
  if (session.isError && !isNotFound(session.error)) {
    return (
      <PublicFrame studio={studio.data}>
        <LoadError error={session.error} onRetry={() => void session.refetch()}>
          לא הצלחנו לטעון את השיעור
        </LoadError>
      </PublicFrame>
    );
  }
  return <ClassView studio={studio.data} session={session.data ?? null} now={now} />;
}

function ClassView({ studio, session, now }: { studio: PublicStudio; session: PublicSession | null; now: Date }) {
  const timeZone = studio.timeZone || defaultTimeZone;
  const today = studioToday(timeZone, now);
  const location = useLocation();
  // Back from signing in with `?reserve=1`: the sheet opens again where the visitor left it.
  const [sheetOpen, setSheetOpen] = useState(() => new URLSearchParams(location.search).has("reserve"));

  if (!session) {
    return (
      <PublicFrame studio={studio}>
        <EmptyState icon="calendar" title="השיעור לא נמצא" titleAs="h1">
          ייתכן שהוסר מהמערכת או שהקישור ישן.
        </EmptyState>
        <Instead studio={studio} session={null} now={now} today={today} />
        <ButtonLink to="/" variant="secondary" block>
          לכל מערכת השיעורים
        </ButtonLink>
      </PublicFrame>
    );
  }

  const state = publicState(session, now);
  const title = session.event?.title ?? session.classType.name;
  const waitlistAction = `רשימת המתנה ל${shortWhen(session, timeZone, today)}`;

  return (
    <main className={`tp-page ${styles.page}`}>
      <section className={styles.stage} aria-labelledby="public-class-title">
        <div className={styles.photo} data-closed={state === "open" ? undefined : true}>
          {session.coverUrl && <img src={session.coverUrl} alt="" />}
          <div className={styles.photoTop}>
            <Link to="/" className={`tp-glass-dark ${styles.studioPill}`}>
              {studio.logoUrl && <img src={studio.logoUrl} alt="" />}
              <span>
                <bdi>{studio.name}</bdi>
              </span>
            </Link>
            <Link to="/" className={`tp-glass-dark ${styles.weekLink}`}>
              כל המערכת
            </Link>
          </div>
        </div>

        <div className={`tp-glass ${styles.sheet}`}>
          {state === "open" ? (
            <Open
              studio={studio}
              session={session}
              now={now}
              title={title}
              line={dateLine(session, timeZone, today)}
              onReserve={() => setSheetOpen(true)}
            />
          ) : (
            <Closed state={state} title={`${title}, ${shortWhen(session, timeZone, today)}`}>
              <Instead studio={studio} session={session} now={now} today={today} />
              {state === "waitlist" && (
                <div className={styles.actions}>
                  <Button variant="secondary" size="lg" block onClick={() => setSheetOpen(true)}>
                    {waitlistAction}
                  </Button>
                  <p className={`tp-caption tp-muted ${styles.center}`}>נודיע לך אם מתפנה מקום.</p>
                </div>
              )}
            </Closed>
          )}
          <p className={`tp-caption tp-muted ${styles.center}`}>
            נבנה עם <bdi>Tempo</bdi>
          </p>
        </div>
      </section>

      {(state === "open" || state === "waitlist") && (
        <ReserveSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          studio={studio}
          title={state === "open" ? "שריינו לי מקום" : waitlistAction}
          returnTo={`/c/${session.id}`}
        />
      )}
    </main>
  );
}

/** A class with room: who teaches it, where, the first-class offer and the button (board א). */
function Open({
  studio,
  session,
  now,
  title,
  line,
  onReserve,
}: {
  studio: PublicStudio;
  session: PublicSession;
  now: Date;
  title: string;
  line: string;
  onReserve: () => void;
}) {
  const left = availabilityChip(session, now);
  const { instructor } = session;
  return (
    <>
      <div className={styles.heading}>
        {left && (
          <div className={styles.chips}>
            <Chip tone={left.tone}>{left.label}</Chip>
          </div>
        )}
        <h1 id="public-class-title" className={`tp-display ${styles.title}`}>
          <bdi>{title}</bdi>
        </h1>
        <p className="tp-muted">{line}</p>
      </div>

      {(instructor || session.roomName) && (
        <ul className={styles.facts}>
          {instructor && (
            <li className={styles.instructor}>
              <Avatar name={instructor.displayName} src={instructor.photoUrl ?? undefined} />
              <div>
                <strong>
                  עם <bdi>{instructor.displayName}</bdi>
                </strong>
                {instructor.headline && <span className="tp-caption tp-muted">{instructor.headline}</span>}
                {instructor.instagramHandle && (
                  <a
                    className="tp-caption"
                    href={`https://www.instagram.com/${encodeURIComponent(instructor.instagramHandle)}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <bdi dir="ltr">@{instructor.instagramHandle}</bdi>
                  </a>
                )}
              </div>
            </li>
          )}
          {session.roomName && (
            <li className={styles.fact}>
              <Icon name="pin" />
              <bdi>{session.roomName}</bdi>
            </li>
          )}
        </ul>
      )}

      {session.event?.description && (
        // Studio text is shown as text, never as markup (S-C).
        <p className={styles.description}>{session.event.description}</p>
      )}

      {studio.introOffer && (
        <div className={`tp-paper ${styles.offerRow}`}>
          <span className={styles.tile} aria-hidden="true">
            <Icon name="gift" />
          </span>
          <div>
            <strong>{offerText(studio.introOffer)}</strong>
            <span className="tp-caption tp-muted">משלמים בסטודיו, בלי כרטיס אשראי עכשיו</span>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Button size="lg" block onClick={onReserve}>
          שריינו לי מקום
        </Button>
      </div>
    </>
  );
}

/** A class a visitor can no longer book, and what to book instead (board ז). */
function Closed({ state, title, children }: { state: PublicClassState; title: string; children: ReactNode }) {
  const chip = closedChip(state);
  const lead =
    state === "full" || state === "waitlist"
      ? "הקישור עדיין עובד. אלה השיעורים הקרובים עם מקום:"
      : "אלה השיעורים הקרובים עם מקום:";
  return (
    <>
      <div className={styles.heading}>
        {chip && (
          <div className={styles.chips}>
            <Chip tone={chip.tone} plain={chip.tone === "neutral"}>
              {chip.label}
            </Chip>
          </div>
        )}
        <h1 id="public-class-title" className={`tp-display ${styles.title}`}>
          <bdi>{title}</bdi>
        </h1>
        <p className="tp-muted">{lead}</p>
      </div>
      {children}
    </>
  );
}

/** Up to three classes with room instead of one that is full, cancelled, over or gone (SL-3, board ז). */
function Instead({
  studio,
  session,
  now,
  today,
}: {
  studio: PublicStudio;
  session: PublicSession | null;
  now: Date;
  today: IsoDate;
}) {
  const sessions = usePublicSessions(studio.slug, today, addDays(today, publicRangeDays - 1));
  const timeZone = studio.timeZone || defaultTimeZone;
  const picks = alternatives(sessions.data ?? [], session, now);
  return (
    <section aria-label="שיעורים עם מקום">
      {sessions.isPending ? (
        <Skeleton height={180} />
      ) : picks.length > 0 ? (
        <div className={`tp-paper ${styles.slots}`}>
          <ul className={styles.slotList}>
            {picks.map((pick) => {
              const chip = roomChip(pick);
              return (
                <li key={pick.id}>
                  <Link to={`/c/${pick.id}`} className={styles.slot}>
                    <time className={`tp-num ${styles.slotTime}`} dateTime={pick.startsAt}>
                      {clockTime(pick.startsAt, timeZone)}
                    </time>
                    <span className={styles.slotBody}>
                      <strong>
                        <bdi>{pick.event?.title ?? pick.classType.name}</bdi>
                      </strong>
                      <span className="tp-caption tp-muted">{slotMeta(pick, timeZone, today)}</span>
                    </span>
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="tp-muted">אין כרגע שיעורים עם מקום בשבועיים הקרובים.</p>
      )}
    </section>
  );
}

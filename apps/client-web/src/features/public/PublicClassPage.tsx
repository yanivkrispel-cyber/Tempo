import { useState } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { useMe } from "../../account/account";
import { NotFoundPage } from "../../app/NotFoundPage";
import { useStudioPath } from "../../app/studioPath";
import { useAuth } from "../../auth/AuthProvider";
import { Avatar, Button, ButtonLink, Card, Chip, EmptyState } from "../../shared/design-system";
import { addDays, type IsoDate } from "../../shared/utilities/dates";
import { useNow } from "../member/clock";
import { relativeDay } from "../member/format";
import { LoadError } from "../member/StudioGate";
import { defaultTimeZone, studioDate, studioToday } from "../member/studioTime";
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
import { PublicSessionRow } from "./PublicSessionRow";
import { alternatives, availabilityChip, offerText, publicState, whenText } from "./publicText";
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
  const state = session ? publicState(session, now) : null;
  const canReserve = state === "open" || state === "waitlist";
  const action = state === "open" ? "שריינו לי מקום" : "הצטרפות לרשימת ההמתנה";
  // Back from signing in with `?reserve=1`: the sheet opens again where the visitor left it.
  const [sheetOpen, setSheetOpen] = useState(() => new URLSearchParams(location.search).has("reserve"));
  const chip = session && availabilityChip(session, now);

  return (
    <PublicFrame studio={studio}>
      {session ? (
        <section className={`tp-hero ${styles.hero}`} aria-labelledby="public-class-title">
          {session.coverUrl && <img className="tp-hero__photo" src={session.coverUrl} alt="" />}
          <div className="tp-hero__top">
            {chip && (
              <Chip tone={chip.tone} plain={chip.tone === "neutral"} className="tp-glass-dark">
                {chip.label}
              </Chip>
            )}
          </div>
          <div className="tp-hero__body">
            <div className="tp-hero__text">
              <span className={styles.when}>{whenText(session, timeZone, today)}</span>
              <h1 id="public-class-title" className="tp-hero__title">
                <bdi>{session.event?.title ?? session.classType.name}</bdi>
              </h1>
              {(session.instructor || session.roomName) && (
                <span className="tp-hero__meta">
                  {[session.instructor && `עם ${session.instructor.displayName}`, session.roomName]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </div>
          </div>
        </section>
      ) : (
        <EmptyState icon="calendar" title="השיעור לא נמצא" titleAs="h1">
          ייתכן שהוסר מהמערכת או שהקישור ישן.
        </EmptyState>
      )}

      {session?.event?.description && (
        <Card>
          {/* Studio text is shown as text, never as markup (S-C). */}
          <p className={styles.description}>{session.event.description}</p>
        </Card>
      )}

      {session?.instructor && (
        <Card className={styles.instructor}>
          <Avatar name={session.instructor.displayName} src={session.instructor.photoUrl ?? undefined} />
          <div>
            <strong>
              <bdi>{session.instructor.displayName}</bdi>
            </strong>
            {session.instructor.headline && <span className="tp-muted">{session.instructor.headline}</span>}
            {session.instructor.instagramHandle && (
              <a
                href={`https://www.instagram.com/${encodeURIComponent(session.instructor.instagramHandle)}/`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <bdi dir="ltr">@{session.instructor.instagramHandle}</bdi>
              </a>
            )}
          </div>
        </Card>
      )}

      {studio.introOffer && canReserve && (
        <Card className={styles.offer}>
          <span className="tp-label tp-muted">פעם ראשונה בסטודיו?</span>
          <strong>{offerText(studio.introOffer)}</strong>
          <span className="tp-muted">נרשמים כאן, משלמים בסטודיו.</span>
        </Card>
      )}

      {canReserve ? (
        <div className={styles.actions}>
          <Button size="lg" block onClick={() => setSheetOpen(true)}>
            {action}
          </Button>
        </div>
      ) : (
        <Instead studio={studio} session={session} now={now} today={today} />
      )}

      {session && canReserve && (
        <ReserveSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          studio={studio}
          title={action}
          returnTo={`/c/${session.id}`}
        />
      )}
    </PublicFrame>
  );
}

/** Classes with room instead of one that is full, cancelled, over or gone (SL-3, board ז). */
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
    <section className={styles.section} aria-labelledby="public-instead">
      <h2 id="public-instead" className={styles.sectionTitle}>
        שיעורים עם מקום
      </h2>
      {picks.length > 0 && (
        <ul className={styles.list}>
          {picks.map((pick) => (
            <PublicSessionRow
              key={pick.id}
              session={pick}
              timeZone={timeZone}
              now={now}
              day={relativeDay(studioDate(pick.startsAt, timeZone), today)}
            />
          ))}
        </ul>
      )}
      {sessions.isSuccess && picks.length === 0 && (
        <p className="tp-muted">אין כרגע שיעורים עם מקום בשבועיים הקרובים.</p>
      )}
      <ButtonLink to="/" variant="secondary" block>
        לכל מערכת השיעורים
      </ButtonLink>
    </section>
  );
}

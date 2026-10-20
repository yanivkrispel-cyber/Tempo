import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useMe } from "../../account/account";
import { NotFoundPage } from "../../app/NotFoundPage";
import { useAuth } from "../../auth/AuthProvider";
import { useStudioPath } from "../../app/studioPath";
import { Button, Card, Chip, shortDate } from "../../shared/design-system";
import { addDays, type IsoDate } from "../../shared/utilities/dates";
import { useNow } from "../member/clock";
import { relativeDay } from "../member/format";
import { LoadError } from "../member/StudioGate";
import { clockTime, defaultTimeZone, studioDate, studioToday } from "../member/studioTime";
import { PublicFrame, PublicSkeleton, StudioNotFound } from "./PublicFrame";
import { PricesView } from "./PublicPricesPage";
import {
  isNotFound,
  publicRangeDays,
  usePublicProduct,
  usePublicSessions,
  usePublicStudio,
  type PublicProduct,
  type PublicSession,
  type PublicStudio,
} from "./publicStudio";
import { availabilityChip, includedText, priceText, publicState, validityText } from "./publicText";
import { ReserveSheet } from "./ReserveSheet";
import styles from "./public.module.css";

/** How many upcoming classes the offer page lists to choose the first one from. */
const pickCount = 6;

/**
 * An offer's page, `/s/<slug>/o/<productId>` (docs/37 section 4.1, SL-4, board י): what the offer is, the first class
 * picked on the same screen, and one action that signs in, joins, takes the offer and books. An offer that ended or
 * is not listed shows the prices page with a line saying so.
 */
export function PublicOfferPage() {
  const slug = useStudioPath();
  const { productId = "" } = useParams();
  if (!slug) return <NotFoundPage />;
  return <Offer slug={slug} productId={productId} />;
}

function Offer({ slug, productId }: { slug: string; productId: string }) {
  const { isSignedIn } = useAuth();
  // Back from the sign-in, the account is made here (`POST /session`) before the join, as on the class page.
  const me = useMe();
  const studio = usePublicStudio(slug);
  const detail = usePublicProduct(slug, productId);
  if ((isSignedIn && me.isPending) || studio.isPending || detail.isPending) return <PublicSkeleton />;
  if (studio.isError) {
    return isNotFound(studio.error) ? (
      <StudioNotFound />
    ) : (
      <PublicFrame studio={null}>
        <LoadError error={studio.error} onRetry={() => void studio.refetch()} />
      </PublicFrame>
    );
  }
  if (detail.isError && !isNotFound(detail.error)) {
    return (
      <PublicFrame studio={studio.data}>
        <LoadError error={detail.error} onRetry={() => void detail.refetch()}>
          לא הצלחנו לטעון את המבצע
        </LoadError>
      </PublicFrame>
    );
  }
  // Not listed (404) or past its last day: the prices, with one line saying so.
  if (detail.isError || detail.data.ended || !detail.data.product) return <PricesView studio={studio.data} ended />;
  return <OfferView studio={studio.data} product={detail.data.product} />;
}

function OfferView({ studio, product }: { studio: PublicStudio; product: PublicProduct }) {
  const now = useNow();
  const timeZone = studio.timeZone || defaultTimeZone;
  const today = studioToday(timeZone, now);
  const sessions = usePublicSessions(studio.slug, today, addDays(today, publicRangeDays - 1));
  // Back from signing in with `?s=<class>&reserve=1`: the class stays chosen and the sheet opens again.
  const query = new URLSearchParams(useLocation().search);
  const [picked, setPicked] = useState<string | null>(() => query.get("s"));
  const [sheetOpen, setSheetOpen] = useState(() => query.has("reserve"));

  const options = [...(sessions.data ?? [])]
    .filter((session) => publicState(session, now) === "open")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, pickCount);
  // The first class is chosen until the visitor chooses another.
  const chosen = options.find((session) => session.id === picked) ?? options[0] ?? null;

  const title = product.priceAgorot === null ? product.name : `${product.name} ב-${priceText(product.priceAgorot)}`;
  const payText =
    product.priceAgorot === null
      ? "משלמים בסטודיו, בשיעור הראשון"
      : `משלמים ${priceText(product.priceAgorot)} בסטודיו, בשיעור הראשון`;
  const until = product.publicUntil ? `, עד ${shortDate(product.publicUntil)}` : "";

  return (
    <PublicFrame studio={studio}>
      <section className={`tp-hero ${styles.studioHero}`} aria-labelledby="public-offer-title">
        {studio.coverUrl && <img className="tp-hero__photo" src={studio.coverUrl} alt="" />}
        <div className="tp-hero__top">
          {product.newcomersOnly && (
            <Chip tone="warning" className="tp-glass-dark">
              {`למצטרפים חדשים${until}`}
            </Chip>
          )}
        </div>
        <div className="tp-hero__body">
          <div className="tp-hero__text">
            <span className={styles.when}>
              <bdi>{studio.name}</bdi>
            </span>
            <h1 id="public-offer-title" className="tp-hero__title">
              <bdi>{title}</bdi>
            </h1>
          </div>
        </div>
      </section>

      <Card className={styles.picks}>
        {/* Studio text is shown as text, never as markup (S-C). */}
        <p className={styles.description}>
          {includedText(product)}, תוך {validityText(product.validDays)} מהשיעור הראשון.
        </p>

        <h2 className={styles.sectionTitle}>בחרו את השיעור הראשון</h2>
        {sessions.isError ? (
          <LoadError error={sessions.error} onRetry={() => void sessions.refetch()}>
            לא הצלחנו לטעון את השיעורים
          </LoadError>
        ) : sessions.isSuccess && options.length === 0 ? (
          <p className="tp-muted">אין כרגע שיעורים עם מקום בשבועיים הקרובים.</p>
        ) : (
          <ul className={styles.pickList}>
            {options.map((session) => (
              <li key={session.id}>
                <Pick
                  session={session}
                  checked={session.id === chosen?.id}
                  onPick={() => setPicked(session.id)}
                  timeZone={timeZone}
                  today={today}
                  now={now}
                />
              </li>
            ))}
          </ul>
        )}
        <Link to="/" className={styles.pickMeta}>
          כל המערכת
        </Link>
      </Card>

      <div className={styles.actions}>
        <Button size="lg" block disabled={!chosen} onClick={() => setSheetOpen(true)}>
          לקחת את המבצע ולשריין
        </Button>
        <p className={`tp-muted ${styles.fine}`}>{payText}</p>
      </div>

      {chosen && (
        <ReserveSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          studio={studio}
          title="לקחת את המבצע ולשריין"
          returnTo={`/o/${product.id}?s=${chosen.id}`}
          offer={{ productId: product.id, sessionId: chosen.id, payText }}
        />
      )}
    </PublicFrame>
  );
}

function Pick({
  session,
  checked,
  onPick,
  timeZone,
  today,
  now,
}: {
  session: PublicSession;
  checked: boolean;
  onPick: () => void;
  timeZone: string;
  today: IsoDate;
  now: Date;
}) {
  const date = studioDate(session.startsAt, timeZone);
  const chip = availabilityChip(session, now, true);
  const name = session.event?.title ?? session.classType.name;
  const meta = [`${relativeDay(date, today)} ${shortDate(date)}`, session.instructor?.displayName]
    .filter(Boolean)
    .join(" · ");
  return (
    <label className={styles.pick}>
      <input type="radio" name="first-class" checked={checked} onChange={onPick} />
      <time className={styles.pickTime} dateTime={session.startsAt}>
        {clockTime(session.startsAt, timeZone)}
      </time>
      <span className={styles.pickText}>
        <strong>
          <bdi>{name}</bdi>
        </strong>
        <span className={`tp-muted ${styles.pickMeta}`}>
          <bdi>{meta}</bdi>
        </span>
        {/* Under the line, not beside it, so a phone keeps the class name on one line. */}
        {chip && session.availability === "few" && (
          <span className={styles.pickChip}>
            <Chip tone={chip.tone}>{session.spotsLeft ? `נשארו ${session.spotsLeft}` : chip.label}</Chip>
          </span>
        )}
      </span>
    </label>
  );
}

import { Banner, Card, Icon, ProgressBar, Skeleton } from "../../shared/design-system";
import { formatDate } from "../../shared/utilities/dates";
import { entriesText, livePasses } from "./bookingState";
import { freezeNote } from "./passText";
import styles from "./member.module.css";
import { passLine } from "./passText";
import { useMyPasses, useStudioClock, type Pass } from "./studio";
import { LoadError } from "./StudioGate";

const noPass = "אין לך כרטיסייה או מנוי בתוקף. כדי להירשם לשיעורים, פנו לסטודיו.";

const summary = (pass: Pass) =>
  passLine({
    id: pass.id,
    name: pass.product.name,
    kind: pass.product.kind,
    endsOn: pass.endsOn,
    entriesLeft: pass.entriesLeft,
  });

/** One line over the timetable: the entries left, so the member knows before booking. */
export function PassStrip({ organizationId }: { organizationId: string }) {
  const passes = useMyPasses(organizationId);
  // A failed read stays quiet here: booking still explains a missing pass.
  if (!passes.data) return null;
  const live = livePasses(passes.data);
  if (live.length === 0) {
    return (
      <Banner tone="warning" icon="credit-card">
        {noPass}
      </Banner>
    );
  }
  return (
    <Card as="section" small tone="cream" className={styles.passStrip} aria-label="הכרטיסייה שלך">
      <span className="tp-icon-tile tp-icon-tile--sm">
        <Icon name="credit-card" />
      </span>
      <span className={styles.passLines}>
        {live.map((pass) => (
          <span key={pass.id}>{summary(pass)}</span>
        ))}
      </span>
    </Card>
  );
}

/** The profile's card: every live pass, with the entries used and left and the end date. */
export function PassesCard({ organizationId }: { organizationId: string }) {
  const passes = useMyPasses(organizationId);
  const { today } = useStudioClock(organizationId);
  if (passes.isPending) return <Skeleton height={140} />;
  const live = passes.data ? livePasses(passes.data) : [];

  return (
    <Card as="section" tone="base" className={styles.plan} aria-labelledby="passes-title">
      <div className={styles.planHead}>
        <h2 id="passes-title" className="tp-eyebrow">
          הכרטיסייה שלך
        </h2>
        <span className="tp-icon-tile tp-icon-tile--sm">
          <Icon name="credit-card" />
        </span>
      </div>
      {passes.isError ? (
        <LoadError error={passes.error} onRetry={() => void passes.refetch()}>
          לא הצלחנו לטעון את הכרטיסיות
        </LoadError>
      ) : live.length === 0 ? (
        <span>{noPass}</span>
      ) : (
        <ul className={styles.passList}>
          {live.map((pass) => (
            <li key={pass.id} className={styles.plan} aria-label={pass.product.name}>
              <span className={styles.planName}>{pass.product.name}</span>
              {pass.product.kind === "punch_card" && pass.entries != null ? (
                <>
                  <span>{entriesText(pass.entriesLeft ?? 0)}</span>
                  <ProgressBar
                    tone="sand"
                    value={pass.entriesUsed}
                    max={pass.entries}
                    label={`כניסות שנוצלו: ${pass.entriesUsed} מתוך ${pass.entries}`}
                  />
                </>
              ) : (
                pass.product.weeklyCap != null && <span>עד {pass.product.weeklyCap} שיעורים בשבוע</span>
              )}
              {freezeNote(pass.freezes, today)}
              <span className="tp-caption">בתוקף עד {formatDate(pass.endsOn)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

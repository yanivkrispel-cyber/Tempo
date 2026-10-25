import type { Schemas } from "@tempo/api-client";
import { Card } from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { displayPhone } from "../../shared/utilities/phones";
import { useStudio } from "../console/studio";
import { usePersonPasses, type Pass } from "../passes/queries";
import styles from "./person.module.css";

type PersonDetail = Schemas["PersonDetail"];

/** The person at a glance on a computer (#488): the pass in force, how to reach them, and since when they are on record. */
export function PersonSummary({ person }: { person: PersonDetail }) {
  const studio = useStudio();
  return (
    <Card as="section" aria-label="סיכום" className={styles.summary}>
      <dl>
        {studio.can("passes.view") && <PassTile personId={person.id} />}
        <div>
          <dt>טלפון</dt>
          <dd>{person.primaryPhone ? <bdi className="tp-ltr">{displayPhone(person.primaryPhone)}</bdi> : "—"}</dd>
        </div>
        <div>
          <dt>מייל</dt>
          <dd>
            {person.primaryEmail ? (
              <bdi className={`tp-ltr ${styles.clip}`} title={person.primaryEmail}>
                {person.primaryEmail}
              </bdi>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>ברשומות מאז</dt>
          <dd className="tp-num">{formatDate(toIsoDate(new Date(person.createdAt)))}</dd>
        </div>
      </dl>
    </Card>
  );
}

function PassTile({ personId }: { personId: string }) {
  const passes = usePersonPasses(personId);
  const live = (passes.data ?? []).filter((pass) => pass.status === "active");
  const [first] = live;
  return (
    <div>
      <dt>בתוקף</dt>
      <dd>
        {!passes.data ? (
          "…"
        ) : !first ? (
          <span className="tp-muted">אין כרטיסייה או מנוי</span>
        ) : (
          <>
            {first.product.name}
            <span className={styles.detail}>
              {passLine(first)}
              {live.length > 1 && ` · ועוד ${live.length - 1}`}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

function passLine(pass: Pass): string {
  const until = `עד ${formatDate(pass.endsOn)}`;
  if (pass.product.kind !== "punch_card") return until;
  const entries = pass.entries ?? 0;
  const left = pass.entriesLeft ?? Math.max(entries - pass.entriesUsed, 0);
  return `${left === 1 ? "נותרה כניסה אחת" : `נותרו ${left} מתוך ${entries}`} · ${until}`;
}

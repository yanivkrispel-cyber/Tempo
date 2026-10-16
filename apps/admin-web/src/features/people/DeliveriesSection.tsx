import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Card, Chip, EmptyState, Skeleton, TableScroll, type ChipTone } from "../../shared/design-system";
import { useStudioTimeZone } from "../../shared/studio/timeZone";
import { useStudio } from "../console/studio";
import { kindLabel } from "../settings/templates";

type Delivery = Schemas["Delivery"];

const channelLabel: Record<Delivery["channel"], string> = {
  inbox: "תיבת ההודעות",
  push: "התראה בטלפון",
  email: "מייל",
};

const statusLabel: Record<Delivery["status"], { label: string; tone: ChipTone }> = {
  queued: { label: "בתור", tone: "neutral" },
  sending: { label: "נשלחת", tone: "neutral" },
  retry_scheduled: { label: "ננסה שוב", tone: "warning" },
  accepted: { label: "נשלחה", tone: "success" },
  delivered: { label: "הגיעה", tone: "success" },
  skipped: { label: "לא נשלחה", tone: "neutral" },
  failed: { label: "נכשלה", tone: "danger" },
  dead: { label: "נכשלה סופית", tone: "danger" },
};

/** Why a delivery was skipped (docs/30 section 7); an error code from the provider shows as it came. */
const reasonLabel: Record<string, string> = {
  preference_off: "כבוי בהעדפות של המתאמן",
  quiet_hours: "בשעות השקט",
  no_subscription: "אין טלפון רשום להתראות",
  undeliverable: "הכתובת לא מקבלת הודעות",
  no_consent: "אין הסכמה לערוץ הזה",
  channel_unavailable: "הערוץ עוד לא פעיל",
};

/** Kinds that have no editable template, so the templates list does not name them. */
const otherKinds: Record<string, string> = {
  "session.message": "הודעה לרשומים לשיעור",
  "studio.announcement": "הודעה לכל הסטודיו",
};

/**
 * A person's last 30 notifications and what happened to each (docs/30 section 7): kind, channel, status and reason,
 * never the text or the address. For `people.view`, like the endpoint.
 */
export function DeliveriesSection({ personId }: { personId: string }) {
  const api = useApi();
  const { organizationId } = useStudio();
  const { timeZone } = useStudioTimeZone();
  const deliveries = useQuery({
    queryKey: ["studio", organizationId, "person", personId, "deliveries"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/people/{personId}/deliveries", {
          params: { path: { organizationId, personId } },
        }),
      ),
  });
  const when = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });

  return (
    <Card as="section" aria-labelledby="deliveries" className="tp-stack">
      <div>
        <h2 id="deliveries">התראות אחרונות</h2>
        <p className="tp-caption tp-muted">30 ההתראות האחרונות ומה קרה לכל אחת. התוכן עצמו לא נשמר כאן.</p>
      </div>
      {deliveries.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(deliveries.error, "לא הצלחנו לטעון את ההתראות. נסו שוב.")}
        </Banner>
      ) : !deliveries.data ? (
        <Skeleton height={120} />
      ) : deliveries.data.items.length === 0 ? (
        <EmptyState icon="bell" title="עוד לא נשלחו התראות.">
          תזכורות, עדכוני הרשמה והודעות מהסטודיו יופיעו כאן.
        </EmptyState>
      ) : (
        <TableScroll label="התראות אחרונות">
          <table className="tp-table tp-table--compact">
            <caption className="tp-sr-only">התראות אחרונות</caption>
            <thead>
              <tr>
                <th scope="col">מתי</th>
                <th scope="col">התראה</th>
                <th scope="col">ערוץ</th>
                <th scope="col">מצב</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data.items.map((delivery) => {
                const status = statusLabel[delivery.status] ?? { label: delivery.status, tone: "neutral" as const };
                const reason = delivery.reason && (reasonLabel[delivery.reason] ?? delivery.reason);
                return (
                  <tr key={delivery.id}>
                    <td className="tp-num">
                      <time dateTime={delivery.updatedAt}>{when.format(new Date(delivery.updatedAt))}</time>
                    </td>
                    <td>{otherKinds[delivery.kind] ?? kindLabel(delivery.kind)}</td>
                    <td>{channelLabel[delivery.channel] ?? delivery.channel}</td>
                    <td>
                      <Chip tone={status.tone}>{status.label}</Chip>
                      {reason && <span className="tp-caption tp-muted"> {reason}</span>}
                      {delivery.attempts > 1 && (
                        <span className="tp-caption tp-muted"> ({delivery.attempts} ניסיונות)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
  );
}

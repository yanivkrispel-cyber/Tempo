import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Card, Chip, Skeleton, type ChipTone } from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";

type SubscriptionState = Schemas["SubscriptionState"];

/** The subscription states (docs/28 section 4) as the studio reads them. */
const states: Record<SubscriptionState, { label: string; tone: ChipTone }> = {
  trialing: { label: "בתקופת ניסיון", tone: "info" },
  active: { label: "פעיל", tone: "success" },
  past_due: { label: "ממתין לתשלום", tone: "warning" },
  grace: { label: "בתקופת חסד", tone: "warning" },
  restricted: { label: "מוגבל", tone: "danger" },
  canceled: { label: "בוטל", tone: "neutral" },
};

/** "₪149 לחודש", or "ללא תשלום" for a free plan such as `pilot`. */
function priceText(plan: Schemas["PlanVersion"]): string {
  if (plan.priceMinor === 0) return "ללא תשלום";
  const amount = new Intl.NumberFormat("he-IL", { style: "currency", currency: plan.currency }).format(
    plan.priceMinor / 100,
  );
  return `${amount} ${plan.interval === "year" ? "לשנה" : "לחודש"}`;
}

/** The studio's Tempo plan and subscription state (GET /billing, `billing.view`). */
export function PlanCard() {
  const api = useApi();
  const studio = useStudio();
  const { organizationId } = studio;
  const billing = useQuery({
    queryKey: ["studio", organizationId, "billing"],
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/billing", { params: { path: { organizationId } } })),
    enabled: studio.can("billing.view"),
  });
  if (!studio.can("billing.view")) return null;

  return (
    <Card as="section" aria-labelledby="plan" className="tp-stack">
      <h2 id="plan">המנוי ל־Tempo</h2>
      {billing.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(billing.error, "לא הצלחנו לטעון את פרטי המנוי. נסו שוב.")}
        </Banner>
      ) : !billing.data ? (
        <div aria-busy="true">
          <span className="tp-sr-only">טוענים את פרטי המנוי…</span>
          <Skeleton height={48} />
        </div>
      ) : (
        <>
          <div className="tp-row" style={{ gap: 8 }}>
            <strong>{billing.data.plan.displayName}</strong>
            <Chip tone={states[billing.data.state].tone}>{states[billing.data.state].label}</Chip>
          </div>
          <p className="tp-muted">
            {priceText(billing.data.plan)}
            {billing.data.state === "trialing" &&
              billing.data.trialEndsAt &&
              ` · הניסיון מסתיים ב־${formatDate(toIsoDate(new Date(billing.data.trialEndsAt)))}`}
            {billing.data.state !== "trialing" &&
              billing.data.currentPeriodEnd &&
              ` · התקופה הנוכחית עד ${formatDate(toIsoDate(new Date(billing.data.currentPeriodEnd)))}`}
          </p>
        </>
      )}
    </Card>
  );
}

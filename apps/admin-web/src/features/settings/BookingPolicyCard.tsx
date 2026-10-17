import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Card, Skeleton, Toggle, useToast } from "../../shared/design-system";
import { useStudio } from "../console/studio";
import { scheduleKeys, useBookingPolicy } from "../schedule/queries";

type BookingPolicy = Schemas["BookingPolicy"];

/**
 * The booking policy's health gate (docs/31 H-5, section 10): "require a signed declaration to book", off by
 * default. Everyone who sees the settings sees it; `schedule.manage` switches it, which saves at once.
 */
export function BookingPolicyCard() {
  const policy = useBookingPolicy();
  return (
    <Card as="section" aria-labelledby="booking-policy" className="tp-stack">
      <h2 id="booking-policy">הרשמה לשיעורים</h2>
      {policy.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(policy.error, "לא הצלחנו לטעון את מדיניות ההרשמה. נסו שוב.")}
        </Banner>
      ) : !policy.data ? (
        <Skeleton height={56} />
      ) : (
        <HealthGate policy={policy.data} />
      )}
    </Card>
  );
}

function HealthGate({ policy }: { policy: BookingPolicy }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const studio = useStudio();
  const editable = studio.can("schedule.manage");
  // Absent until the server builds it (docs/31): read as off.
  const on = policy.requireHealthDeclaration ?? false;

  const save = useMutation({
    mutationKey: [studio.organizationId, "schedule.policy.update"],
    mutationFn: (requireHealthDeclaration: boolean) =>
      unwrap(
        api.PUT("/api/v1/organizations/{organizationId}/booking-policy", {
          params: { path: { organizationId: studio.organizationId }, header: { "If-Match": policy.version } },
          body: {
            freeCancelHours: policy.freeCancelHours,
            waitlistCutoffHours: policy.waitlistCutoffHours,
            bookingHorizonDays: policy.bookingHorizonDays,
            waitlistEnabled: policy.waitlistEnabled,
            requireHealthDeclaration,
          },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(scheduleKeys.policy(studio.organizationId), updated);
      toast.show({
        tone: "success",
        icon: "check",
        message: updated.requireHealthDeclaration
          ? "מעכשיו הרשמה לשיעור דורשת הצהרת בריאות חתומה"
          : "ההרשמה לשיעורים כבר לא דורשת הצהרת בריאות",
      });
    },
  });

  return (
    <>
      <Toggle
        label="הרשמה רק עם הצהרת בריאות חתומה"
        checked={save.isPending ? save.variables : on}
        disabled={!editable || save.isPending}
        onChange={(event) => save.mutate(event.target.checked)}
      />
      <p className="tp-caption tp-muted">
        כשזה פועל, מתאמן.ת שההצהרה שלו.ה חסרה, פגה או ממתינה לאישור רפואי לא יכול.ה להירשם לבד לשיעור או לרשימת ההמתנה.
        רישום על ידי הצוות לא נחסם, והוא נרשם ביומן הפעולות. הרשמות קיימות לא מתבטלות.
      </p>
      {save.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(save.error, "לא הצלחנו לשמור. נסו שוב.")}
        </Banner>
      )}
    </>
  );
}

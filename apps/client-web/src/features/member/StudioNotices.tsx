import { activeMemberships, subscriptionStateOf, useAccount } from "../../account/account";
import { codeMessage } from "../../api/errors";
import { useProblemCode } from "../../api/problems";
import { Banner } from "../../shared/design-system";

/**
 * Booking is paused in the member's studio: GET /me says its subscription is `restricted` (docs/28 section 4), or a
 * request already answered 402 `billing.restricted` (before GET /me carries `subscriptionState`, or since it
 * changed). Reads and cancelling still work; only new bookings stop.
 */
export function useBookingPaused(): boolean {
  const me = useAccount();
  const failed = useProblemCode(["billing.restricted"]);
  return subscriptionStateOf(activeMemberships(me)[0]) === "restricted" || failed;
}

/** The states that block the member's studio as a whole, under each screen's heading. */
export function StudioNotices() {
  const paused = useBookingPaused();
  // An owner or admin who also uses the member app, before turning on MFA (docs/27 section 3.6, A-5).
  const mfa = useProblemCode(["auth.mfa_required"]);
  if (!paused && !mfa) return null;
  return (
    <>
      {mfa && (
        <Banner tone="warning" icon="info">
          {codeMessage("auth.mfa_required")}
        </Banner>
      )}
      {paused && (
        <Banner tone="warning" icon="info">
          {codeMessage("billing.restricted")}
        </Banner>
      )}
    </>
  );
}

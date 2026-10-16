import { subscriptionStateOf } from "../../account/account";
import { codeMessage } from "../../api/errors";
import { useProblemCode } from "../../api/problems";
import { Banner, ButtonLink } from "../../shared/design-system";
import { securityPath } from "../security/SecurityPage";
import { useStudio } from "./studio";

/**
 * The states that block the studio's pages as a whole, once above the page (each page still shows its own error):
 * an owner or admin without MFA gets 403 `auth.mfa_required` on every studio route (docs/27 section 3.6, A-5), and a
 * restricted subscription answers writes with 402 `billing.restricted` (docs/28 section 4). The subscription state
 * comes from GET /me when it carries it, or from a request that already answered 402.
 */
export function ConsoleNotices() {
  const { membership, organizationId } = useStudio();
  const mfa = useProblemCode(["auth.mfa_required"], organizationId);
  const restricted =
    useProblemCode(["billing.restricted"], organizationId) || subscriptionStateOf(membership) === "restricted";
  if (!mfa && !restricted) return null;
  return (
    <>
      {mfa && (
        <Banner tone="warning" icon="shield">
          <div className="tp-stack" style={{ gap: 8 }}>
            <span>{codeMessage("auth.mfa_required")} ההגדרה לוקחת כדקה, עם אפליקציית אימות בטלפון.</span>
            <div>
              <ButtonLink to={securityPath} variant="secondary" size="sm" icon="shield">
                הפעלת אימות דו־שלבי
              </ButtonLink>
            </div>
          </div>
        </Banner>
      )}
      {restricted && (
        <Banner tone="warning" icon="credit-card">
          {codeMessage("billing.restricted")}
        </Banner>
      )}
    </>
  );
}

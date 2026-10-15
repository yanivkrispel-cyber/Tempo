import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useLocation } from "react-router";
import { meKey } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { Banner, Button, Dialog, useToast } from "../../shared/design-system";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useStudio } from "../console/studio";

type Member = Schemas["Member"];

const day = (iso: string) => formatDate(toIsoDate(new Date(iso)));

/** After any change to an offer, GET /me (the pending offer, and the roles after a handover) and the members. */
function useRefreshAfterTransfer() {
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: meKey }),
      queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "members"] }),
    ]);
}

/**
 * The owner offers the studio to an active admin (docs/27 section 3.5): the admin has 72 hours to accept; on
 * acceptance they become the owner and the owner an admin. Starting needs a recent sign-in (step-up).
 */
export function TransferDialog({ member, name, onClose }: { member: Member; name: string; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshAfterTransfer();
  const { client } = useAuth();
  const { pathname } = useLocation();
  const { organizationId, displayName } = useStudio();
  const start = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/ownership-transfer", {
          params: { path: { organizationId } },
          body: { toMembershipId: member.id },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast.show({ tone: "success", icon: "check", message: `ההצעה נשלחה ל${name}` });
      onClose();
    },
  });
  const stepUp = hasCode(start.error, "auth.step_up_required");

  return (
    <Dialog
      open
      onClose={onClose}
      title="העברת הבעלות"
      description={`${name} יקבל/תקבל הצעה להיות הבעלים של ${displayName}. אחרי האישור התפקיד שלך יהיה מנהל.`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button variant="danger" loading={start.isPending} onClick={() => start.mutate()}>
            שליחת ההצעה
          </Button>
        </>
      }
    >
      <div className="tp-stack">
        <p className="tp-muted">ההצעה בתוקף 72 שעות. עד שתתקבל אפשר לבטל אותה.</p>
        {start.isError && (
          <Banner tone={stepUp ? "warning" : "danger"} icon="info">
            {errorMessage(start.error, "לא הצלחנו לשלוח את ההצעה. נסו שוב.")}
          </Banner>
        )}
        {stepUp && (
          <Button variant="secondary" icon="log-out" onClick={() => void client?.signIn(pathname, "reauthenticate")}>
            התחברות מחדש
          </Button>
        )}
      </div>
    </Dialog>
  );
}

/** For the owner who made an offer: until when it waits, and a way to take it back. */
export function OutgoingTransferBanner() {
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshAfterTransfer();
  const { organizationId, membership } = useStudio();
  const pending = membership.pendingOwnershipTransfer;
  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE("/api/v1/organizations/{organizationId}/ownership-transfer", {
          params: { path: { organizationId } },
        }),
      ),
    onSuccess: () => toast.show({ tone: "success", icon: "check", message: "ההצעה בוטלה" }),
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
    onSettled: refresh,
  });

  if (pending?.direction !== "outgoing") return null;
  return (
    <Banner tone="info" icon="info">
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <span>הצעת העברת הבעלות ממתינה לתשובה עד {day(pending.expiresAt)}.</span>
        <Button variant="ghost-danger" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>
          ביטול ההצעה
        </Button>
      </div>
    </Banner>
  );
}

/** For the admin who was offered the studio: accept (become the owner) or decline. */
export function IncomingTransferBanner() {
  const api = useApi();
  const toast = useToast();
  const refresh = useRefreshAfterTransfer();
  const { organizationId, displayName, membership } = useStudio();
  const pending = membership.pendingOwnershipTransfer;
  const answer = useMutation({
    mutationFn: (accept: boolean) =>
      accept
        ? unwrap(
            api.POST("/api/v1/organizations/{organizationId}/ownership-transfer/accept", {
              params: { path: { organizationId } },
            }),
          )
        : unwrap(
            api.POST("/api/v1/organizations/{organizationId}/ownership-transfer/decline", {
              params: { path: { organizationId } },
            }),
          ),
    onSuccess: (_, accept) =>
      toast.show({
        tone: "success",
        icon: "check",
        message: accept ? `מעכשיו הבעלות על ${displayName} שלך` : "ההצעה נדחתה",
      }),
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
    onSettled: refresh,
  });

  if (pending?.direction !== "incoming") return null;
  return (
    <Banner tone="warning" icon="info">
      <div className="tp-stack" style={{ gap: 8 }}>
        <span>
          הוצעה לך הבעלות על {displayName}. ההצעה בתוקף עד {day(pending.expiresAt)}. אם תקבלו אותה, תהיו הבעלים של
          הסטודיו, ובעלי הסטודיו הנוכחיים יהיו מנהלים.
        </span>
        <div className="tp-row">
          <Button size="sm" loading={answer.isPending && answer.variables} onClick={() => answer.mutate(true)}>
            קבלת הבעלות
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={answer.isPending && !answer.variables}
            onClick={() => answer.mutate(false)}
          >
            דחייה
          </Button>
        </div>
      </div>
    </Banner>
  );
}

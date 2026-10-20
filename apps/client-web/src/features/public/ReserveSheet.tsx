import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../api/errors";
import { meKey } from "../../account/account";
import { useAuth } from "../../auth/AuthProvider";
import { SignInButtons } from "../../auth/SignInButtons";
import { Banner, Button, Dialog } from "../../shared/design-system";
import { chooseStudio } from "../member/studioChoice";
import { useJoinStudio, type PublicStudio } from "./publicStudio";
import { offerText } from "./publicText";
import styles from "./public.module.css";

/**
 * "שריינו לי מקום" on the studio's public pages (SL-2, docs/37 section 4.3), on the same address: a visitor signs in
 * or signs up and comes back here with the sheet open; a signed-in visitor joins the studio with the source the app
 * kept. Once the account lists the studio, the page hands over to the member app's own class screen and booking.
 */
export function ReserveSheet({
  open,
  onClose,
  studio,
  title,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  studio: PublicStudio;
  title: string;
  /** Where to come back after signing in, inside the studio's app; the sheet opens again there. */
  returnTo: string;
}) {
  const { isSignedIn } = useAuth();
  const join = useJoinStudio(studio.slug);
  const queryClient = useQueryClient();
  const offer = studio.introOffer;

  const body = !studio.openJoin ? (
    <p className="tp-muted">
      <bdi>{studio.name}</bdi> מצרפים מתאמנים בהזמנה. בקשו מהסטודיו קישור הצטרפות, ומשם נרשמים לשיעור.
    </p>
  ) : !isSignedIn ? (
    <>
      <p className="tp-muted">מתחברים או נרשמים עם המייל, וחוזרים לכאן לשריון המקום. נרשמים כאן, משלמים בסטודיו.</p>
      <SignInButtons returnTo={`${returnTo}${returnTo.includes("?") ? "&" : "?"}reserve=1`} />
    </>
  ) : (
    <>
      <p className="tp-muted">
        ההצטרפות ל<bdi>{studio.name}</bdi> בחינם. אחריה בוחרים את השיעור ומשלמים בסטודיו.
      </p>
      {join.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(join.error, "לא הצלחנו לצרף אותך. נסו שוב.")}
        </Banner>
      )}
      <Button
        size="lg"
        block
        loading={join.isPending}
        onClick={() =>
          join.mutate(undefined, {
            // The account lists the studio once it is read again; the page then moves to the member's booking.
            onSuccess: async ({ organizationId }) => {
              chooseStudio(organizationId);
              await queryClient.invalidateQueries({ queryKey: meKey });
            },
          })
        }
      >
        הצטרפות לסטודיו והמשך
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={() => {
        join.reset();
        onClose();
      }}
      title={title}
      description={offer ? offerText(offer) : undefined}
    >
      <div className={styles.sheetBody}>{body}</div>
    </Dialog>
  );
}

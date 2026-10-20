import { TempoApiError } from "@tempo/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { CognitoSignIn, cognitoRegion, type CognitoTokens } from "@tempo/api-client/auth";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { meKey } from "../../account/account";
import { useAuth } from "../../auth/AuthProvider";
import { brandedLoginEnabled } from "../../auth/config";
import { SignInButtons } from "../../auth/SignInButtons";
import { Banner, Button, ButtonLink, Dialog } from "../../shared/design-system";
import { OpenInBrowserCard } from "../member/OpenInBrowserCard";
import { chooseStudio } from "../member/studioChoice";
import {
  joinStudio,
  useJoinStudio,
  type OfferChoice,
  type PublicJoinResponse,
  type PublicStudio,
} from "./publicStudio";
import { offerText } from "./publicText";
import { SheetSignUp, type SheetSignUpApi } from "./SheetSignUp";
import styles from "./public.module.css";

/** The refusals of taking an offer (SL-4), in plain words; the rest use the app's shared sentences. */
const offerMessages: Record<string, string> = {
  "product.not_found": "המבצע הזה כבר לא מוצג. אפשר לראות את המחירים בעמוד המחירים.",
  "offer.ended": "המבצע הסתיים. אפשר לראות את המחירים בעמוד המחירים.",
  "offer.not_newcomer": "המבצע מיועד למצטרפים חדשים בלבד, ונראה שכבר השתמשתם בו בסטודיו הזה.",
  "session.full": "השיעור שבחרתם התמלא. סגרו את החלון ובחרו שיעור אחר.",
  "session.not_bookable": "אי אפשר להירשם לשיעור שבחרתם. סגרו את החלון ובחרו שיעור אחר.",
  "session.not_found": "השיעור שבחרתם לא נמצא. סגרו את החלון ובחרו שיעור אחר.",
};

/** What taking an offer needs: the product and the first class, and the words for the payment. */
export interface ReserveOffer extends OfferChoice {
  /** "משלמים 99 ₪ בסטודיו, בשיעור הראשון". */
  payText: string;
}

/**
 * "שריינו לי מקום" on the studio's public pages (SL-2, docs/37 section 4.3), on the same address: a visitor signs in
 * or signs up and comes back here with the sheet open; a signed-in visitor joins the studio with the source the app
 * kept. Once the account lists the studio, the page hands over to the member app's own class screen and booking.
 * With `branded_login` on, a newcomer signs up inside the sheet instead (board ב) and joins straight after the code.
 * With `offer` the same sheet takes the offer: one call joins, grants the pass to pay at the studio and books the
 * first class (SL-4).
 */
export function ReserveSheet({
  open,
  onClose,
  studio,
  title,
  returnTo,
  signUpApi,
  offer: taking,
}: {
  open: boolean;
  onClose: () => void;
  studio: PublicStudio;
  title: string;
  /** Where to come back after signing in, inside the studio's app; the sheet opens again there. */
  returnTo: string;
  /** A fake Cognito for tests; otherwise the sheet builds its own from the auth config. */
  signUpApi?: SheetSignUpApi;
  offer?: ReserveOffer;
}) {
  const { client, isSignedIn } = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const join = useJoinStudio(studio.slug);
  const queryClient = useQueryClient();
  const offer = taking ? null : studio.introOffer;
  const back = `${returnTo}${returnTo.includes("?") ? "&" : "?"}reserve=1`;
  const region = client ? cognitoRegion(client.config.cognitoDomain) : null;
  const cognito = useMemo<SheetSignUpApi | null>(
    () =>
      signUpApi ??
      (brandedLoginEnabled() && client && region
        ? new CognitoSignIn({ region, clientId: client.config.clientId })
        : null),
    [signUpApi, client, region],
  );
  // The answer of an offer taken by the sheet's own sign-up; the signed-in button keeps its answer in `join`.
  const [signedUpDone, setSignedUpDone] = useState<PublicJoinResponse | null>(null);
  const choice = taking && { productId: taking.productId, sessionId: taking.sessionId };

  const joinAndContinue = () =>
    join.mutate(choice, {
      // The account lists the studio once it is read again; the page then moves to the member's booking.
      onSuccess: async ({ organizationId }) => {
        chooseStudio(organizationId);
        await queryClient.invalidateQueries({ queryKey: meKey });
      },
    });

  /**
   * In after the code: the account (`POST /session` makes it), the name typed in the sheet and the studio, all with
   * the new token before the app adopts it. The account then already lists the studio, so the page goes straight to
   * the booking instead of loading the account again in between. An offer is taken in the same call.
   */
  const signedUp = async (tokens: CognitoTokens, name: string) => {
    const headers = { Authorization: `Bearer ${tokens.accessToken}` };
    try {
      await unwrap(api.POST("/api/v1/session", { headers }));
      if (name) await unwrap(api.PATCH("/api/v1/me", { body: { displayName: name }, headers })).catch(() => undefined);
      const response = await joinStudio(api, studio.slug, headers, choice ?? undefined);
      chooseStudio(response.organizationId);
      queryClient.setQueryData(meKey, await unwrap(api.POST("/api/v1/session", { headers })));
      if (taking) setSignedUpDone(response);
    } catch {
      // Signed in all the same: the sheet then offers "הצטרפות לסטודיו והמשך", which says what went wrong.
    }
    client?.adopt(tokens);
  };

  const done = join.data ?? signedUpDone;
  const body =
    done && taking ? (
      <OfferDone response={done} sessionId={taking.sessionId} />
    ) : !studio.openJoin ? (
      <p className="tp-muted">
        <bdi>{studio.name}</bdi> מצרפים מתאמנים בהזמנה. בקשו מהסטודיו קישור הצטרפות, ומשם נרשמים לשיעור.
      </p>
    ) : !isSignedIn && cognito ? (
      <SheetSignUp
        cognito={cognito}
        onSignedIn={signedUp}
        onSignIn={() => void navigate(`/login?${new URLSearchParams({ returnTo: back }).toString()}`)}
      />
    ) : !isSignedIn ? (
      <>
        <p className="tp-muted">מתחברים או נרשמים עם המייל, וחוזרים לכאן לשריון המקום. נרשמים כאן, משלמים בסטודיו.</p>
        <SignInButtons returnTo={back} />
      </>
    ) : (
      <>
        <p className="tp-muted">
          {taking ? (
            <>
              נצרף אתכם ל<bdi>{studio.name}</bdi>, נשמור את המבצע ונשריין את השיעור שבחרתם. ההצטרפות בחינם.
            </>
          ) : (
            <>
              ההצטרפות ל<bdi>{studio.name}</bdi> בחינם. אחריה בוחרים את השיעור ומשלמים בסטודיו.
            </>
          )}
        </p>
        {join.isError && (
          <Banner tone="danger" icon="info">
            {(join.error instanceof TempoApiError && taking && offerMessages[join.error.code]) ||
              errorMessage(join.error, "לא הצלחנו לצרף אותך. נסו שוב.")}
          </Banner>
        )}
        <Button size="lg" block loading={join.isPending} onClick={joinAndContinue}>
          {taking ? "לקחת את המבצע ולשריין" : "הצטרפות לסטודיו והמשך"}
        </Button>
        {taking && <p className="tp-caption">{taking.payText}</p>}
      </>
    );

  return (
    <Dialog
      open={open}
      onClose={() => {
        join.reset();
        onClose();
      }}
      title={done && taking ? "המבצע שלכם" : title}
      description={offer ? offerText(offer) : undefined}
    >
      <div className={styles.sheetBody}>{body}</div>
    </Dialog>
  );
}

/** After the call: the class is booked or on the waitlist, or the studio asks for a health declaration first. */
function OfferDone({ response, sessionId }: { response: PublicJoinResponse; sessionId: string }) {
  if (response.next === "health_declaration") {
    return (
      <>
        <Banner tone="warning" icon="info">
          המבצע שמור. הסטודיו מבקש הצהרת בריאות חתומה לפני ההרשמה לשיעור, ואחריה נשריין את המקום.
        </Banner>
        <ButtonLink to="/profile/health" size="lg" block>
          למילוי הצהרת הבריאות
        </ButtonLink>
        <ButtonLink to={`/classes/${sessionId}?book=1`} variant="secondary" block>
          לשיעור, אחרי החתימה
        </ButtonLink>
      </>
    );
  }
  const waitlisted = response.booking?.status === "waitlisted";
  return (
    <>
      <Banner tone="success" icon="check">
        {waitlisted
          ? "המבצע שמור, והמקום שלכם ברשימת ההמתנה של השיעור. נעדכן אם יתפנה מקום."
          : "המבצע שמור והשיעור שוריין. משלמים בסטודיו, בשיעור הראשון."}
      </Banner>
      <ButtonLink to={`/classes/${sessionId}`} size="lg" block>
        לפרטי השיעור
      </ButtonLink>
      <OpenInBrowserCard />
    </>
  );
}

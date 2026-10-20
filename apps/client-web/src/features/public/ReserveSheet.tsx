import { useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { CognitoSignIn, cognitoRegion, type CognitoTokens } from "@tempo/api-client/auth";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { meKey } from "../../account/account";
import { useAuth } from "../../auth/AuthProvider";
import { brandedLoginEnabled } from "../../auth/config";
import { SignInButtons } from "../../auth/SignInButtons";
import { Banner, Button, Dialog } from "../../shared/design-system";
import { chooseStudio } from "../member/studioChoice";
import { joinStudio, useJoinStudio, type PublicStudio } from "./publicStudio";
import { offerText } from "./publicText";
import { SheetSignUp, type SheetSignUpApi } from "./SheetSignUp";
import styles from "./public.module.css";

/**
 * "שריינו לי מקום" on the studio's public pages (SL-2, docs/37 section 4.3), on the same address: a visitor signs in
 * or signs up and comes back here with the sheet open; a signed-in visitor joins the studio with the source the app
 * kept. Once the account lists the studio, the page hands over to the member app's own class screen and booking.
 * With `branded_login` on, a newcomer signs up inside the sheet instead (board ב) and joins straight after the code.
 */
export function ReserveSheet({
  open,
  onClose,
  studio,
  title,
  returnTo,
  signUpApi,
}: {
  open: boolean;
  onClose: () => void;
  studio: PublicStudio;
  title: string;
  /** Where to come back after signing in, inside the studio's app; the sheet opens again there. */
  returnTo: string;
  /** A fake Cognito for tests; otherwise the sheet builds its own from the auth config. */
  signUpApi?: SheetSignUpApi;
}) {
  const { client, isSignedIn } = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const join = useJoinStudio(studio.slug);
  const queryClient = useQueryClient();
  const offer = studio.introOffer;
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

  const joinAndContinue = () =>
    join.mutate(undefined, {
      // The account lists the studio once it is read again; the page then moves to the member's booking.
      onSuccess: async ({ organizationId }) => {
        chooseStudio(organizationId);
        await queryClient.invalidateQueries({ queryKey: meKey });
      },
    });

  /**
   * In after the code: the account (`POST /session` makes it), the name typed in the sheet and the studio, all with
   * the new token before the app adopts it. The account then already lists the studio, so the page goes straight to
   * the booking instead of loading the account again in between.
   */
  const signedUp = async (tokens: CognitoTokens, name: string) => {
    const headers = { Authorization: `Bearer ${tokens.accessToken}` };
    try {
      await unwrap(api.POST("/api/v1/session", { headers }));
      if (name) await unwrap(api.PATCH("/api/v1/me", { body: { displayName: name }, headers })).catch(() => undefined);
      const { organizationId } = await joinStudio(api, studio.slug, headers);
      chooseStudio(organizationId);
      queryClient.setQueryData(meKey, await unwrap(api.POST("/api/v1/session", { headers })));
    } catch {
      // Signed in all the same: the sheet then offers "הצטרפות לסטודיו והמשך", which says what went wrong.
    }
    client?.adopt(tokens);
  };

  const body = !studio.openJoin ? (
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
        ההצטרפות ל<bdi>{studio.name}</bdi> בחינם. אחריה בוחרים את השיעור ומשלמים בסטודיו.
      </p>
      {join.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(join.error, "לא הצלחנו לצרף אותך. נסו שוב.")}
        </Banner>
      )}
      <Button size="lg" block loading={join.isPending} onClick={joinAndContinue}>
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

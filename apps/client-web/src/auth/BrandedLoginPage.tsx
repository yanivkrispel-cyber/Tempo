import { CognitoSignIn, cognitoRegion, type AuthClient } from "@tempo/api-client/auth";
import { useMemo } from "react";
import { BrandedSignIn, type SignInBrand } from "./branded/BrandedSignIn";

const tempoBrand: SignInBrand = { name: "Tempo" };

export interface BrandedLoginPageProps {
  client: AuthClient;
  /** Already checked by the page that renders it (docs/36 section 5.1). */
  returnTo: string;
  initialView?: "email" | "signup";
  brand?: SignInBrand;
}

/**
 * Our own sign-in over Cognito `USER_AUTH` (docs/36), behind `branded_login`. The tokens go to `authClient.adopt`;
 * the page that renders this then sees the session and goes to `returnTo`. The usual Hosted UI stays one tap away.
 * Null when the Cognito domain does not name a region: the caller then keeps the Hosted UI.
 */
export function BrandedLoginPage({ client, returnTo, initialView, brand = tempoBrand }: BrandedLoginPageProps) {
  const region = cognitoRegion(client.config.cognitoDomain);
  const cognito = useMemo(
    () => (region ? new CognitoSignIn({ region, clientId: client.config.clientId }) : null),
    [region, client.config.clientId],
  );
  if (!cognito) return null;
  return (
    <BrandedSignIn
      brand={brand}
      cognito={cognito}
      initialView={initialView}
      onSignedIn={(tokens) => client.adopt(tokens)}
      onHostedUi={() => void client.signIn(returnTo, initialView === "signup" ? "signup" : "login")}
    />
  );
}

import { cognitoRegion, safeReturnTo } from "@tempo/api-client/auth";
import { Navigate, useSearchParams } from "react-router";
import { useStudioPath } from "../app/studioPath";
import { useStudioBrand } from "../app/studioLook";
import { useAuth } from "./AuthProvider";
import { BrandedLoginPage } from "./BrandedLoginPage";
import { brandedLoginEnabled } from "./config";
import { SignInButtons } from "./SignInButtons";

/**
 * With `branded_login` on, our own sign-in screen (docs/36); otherwise sign-in and sign-up both go to the Cognito
 * Hosted UI and this page only explains and sends the visitor there. In a studio's own app the screen wears that
 * studio's name, logo and accent (WL5); Tempo's when its brand cannot be read.
 */
export function LoginPage() {
  const { client, isSignedIn } = useAuth();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo") ?? "/");
  const studioBrand = useStudioBrand(useStudioPath());

  if (isSignedIn) return <Navigate to={returnTo} replace />;

  if (brandedLoginEnabled() && client && cognitoRegion(client.config.cognitoDomain)) {
    // Not Tempo's look first and the studio's a moment later: wait for the brand, which is cached after the first read.
    if (studioBrand.isLoading) return null;
    const brand = studioBrand.data;
    return (
      <BrandedLoginPage
        client={client}
        returnTo={returnTo}
        initialView={params.get("screen") === "signup" ? "signup" : "email"}
        brand={brand ? { name: brand.appName, logoUrl: brand.logoUrl, accent: brand.accentId } : undefined}
      />
    );
  }

  return (
    <main className="tp-page tp-page--center">
      <div className="tp-card tp-stack">
        <span className="tp-rail__logo" aria-hidden="true">
          T
        </span>
        <h1>ברוכים הבאים ל־Tempo</h1>
        <p className="tp-muted">התחברו כדי לראות את השיעורים וההזמנות שלכם.</p>
        <SignInButtons returnTo={returnTo} />
      </div>
    </main>
  );
}

import { safeReturnTo } from "@tempo/api-client/auth";
import { Navigate, useSearchParams } from "react-router";
import { useAuth } from "./AuthProvider";
import { SignInButtons } from "./SignInButtons";

/** Sign-in and sign-up both go to the Cognito Hosted UI; this page only explains and sends the visitor there. */
export function LoginPage() {
  const { isSignedIn } = useAuth();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo") ?? "/");

  if (isSignedIn) return <Navigate to={returnTo} replace />;

  return (
    <main className="tp-page">
      <div className="tp-card tp-stack">
        <h1>
          ניהול הסטודיו ב־<bdi>Tempo</bdi>
        </h1>
        <p className="tp-muted">התחברו כדי לנהל את הסטודיו: החברים, ההזמנות וההגדרות.</p>
        <SignInButtons returnTo={returnTo} />
      </div>
    </main>
  );
}

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

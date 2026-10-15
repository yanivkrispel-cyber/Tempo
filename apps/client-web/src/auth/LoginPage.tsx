import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Banner, Button } from "../shared/design-system";
import { safeReturnTo } from "./authClient";
import { useAuth } from "./AuthProvider";

/** Sign-in and sign-up both go to the Cognito Hosted UI; this page only explains and sends the visitor there. */
export function LoginPage() {
  const { client, isSignedIn } = useAuth();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo") ?? "/");
  const [leaving, setLeaving] = useState<"login" | "signup" | null>(null);

  if (isSignedIn) return <Navigate to={returnTo} replace />;

  const go = (screen: "login" | "signup") => {
    if (!client) return;
    setLeaving(screen);
    void client.signIn(returnTo, screen);
  };

  return (
    <main className="tp-page">
      <div className="tp-card tp-stack">
        <h1>ברוכים הבאים ל־Tempo</h1>
        <p className="tp-muted">התחברו כדי לראות את השיעורים וההזמנות שלכם.</p>
        {client ? (
          <>
            <Button block loading={leaving === "login"} onClick={() => go("login")}>
              התחברות
            </Button>
            <Button block variant="secondary" loading={leaving === "signup"} onClick={() => go("signup")}>
              הרשמה
            </Button>
          </>
        ) : (
          <Banner tone="warning" icon="info">
            ההתחברות לא מוגדרת בסביבה הזו (VITE_COGNITO_DOMAIN, VITE_COGNITO_CLIENT_ID).
          </Banner>
        )}
      </div>
    </main>
  );
}

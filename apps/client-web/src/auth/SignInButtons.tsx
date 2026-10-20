import { useState } from "react";
import { useNavigate } from "react-router";
import { Banner, Button } from "../shared/design-system";
import { useAuth } from "./AuthProvider";
import { brandedLoginEnabled } from "./config";

/**
 * Sign-in and sign-up, through the Cognito Hosted UI, or through our own screen on `/login` when `branded_login` is
 * on; back to `returnTo` afterwards.
 */
export function SignInButtons({ returnTo, beforeLeave }: { returnTo: string; beforeLeave?: () => void }) {
  const { client } = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState<"login" | "signup" | null>(null);

  if (!client) {
    return (
      <Banner tone="warning" icon="info">
        ההתחברות לא מוגדרת בסביבה הזו (VITE_COGNITO_DOMAIN, VITE_COGNITO_CLIENT_ID).
      </Banner>
    );
  }

  const go = (screen: "login" | "signup") => {
    beforeLeave?.();
    if (brandedLoginEnabled()) {
      const query = new URLSearchParams({ returnTo, ...(screen === "signup" ? { screen } : {}) });
      return void navigate(`/login?${query.toString()}`);
    }
    setLeaving(screen);
    void client.signIn(returnTo, screen);
  };

  return (
    <>
      <Button block loading={leaving === "login"} onClick={() => go("login")}>
        התחברות
      </Button>
      <Button block variant="secondary" loading={leaving === "signup"} onClick={() => go("signup")}>
        הרשמה
      </Button>
    </>
  );
}

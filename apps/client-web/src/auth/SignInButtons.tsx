import { useState } from "react";
import { Banner, Button } from "../shared/design-system";
import { useAuth } from "./AuthProvider";

/** Sign-in and sign-up, both through the Cognito Hosted UI; back to `returnTo` afterwards. */
export function SignInButtons({ returnTo, beforeLeave }: { returnTo: string; beforeLeave?: () => void }) {
  const { client } = useAuth();
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

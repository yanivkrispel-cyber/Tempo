import { SignInError } from "@tempo/api-client/auth";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Banner, ButtonLink, Skeleton } from "../shared/design-system";
import { useAuth } from "./AuthProvider";

/** `/auth/callback`: the Hosted UI returns here with `?code&state`. */
export function CallbackPage() {
  const { client } = useAuth();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [failed, setFailed] = useState<"denied" | "other" | null>(client ? null : "other");

  useEffect(() => {
    if (!client) return;
    let current = true;
    client.completeSignIn(search).then(
      (returnTo) => {
        // replace: the code is single-use, so Back must not return to this URL.
        if (current) void navigate(returnTo, { replace: true });
      },
      (error: unknown) => {
        if (current) setFailed(error instanceof SignInError && error.code === "denied" ? "denied" : "other");
      },
    );
    return () => {
      current = false;
    };
  }, [client, search, navigate]);

  if (!failed) {
    return (
      <main className="tp-page" aria-busy="true">
        <span className="tp-sr-only">מתחברים…</span>
        <Skeleton height={120} />
      </main>
    );
  }

  return (
    <main className="tp-page tp-stack">
      <Banner tone="danger" icon="info">
        {failed === "denied" ? "ההתחברות בוטלה." : "ההתחברות נכשלה. נסו שוב."}
      </Banner>
      <ButtonLink to="/login" replace variant="secondary">
        חזרה להתחברות
      </ButtonLink>
    </main>
  );
}

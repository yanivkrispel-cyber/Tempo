import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap } from "@tempo/api-client";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { meKey, roleName, useMe } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage, hasCode } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { SignInButtons } from "../../auth/SignInButtons";
import { Banner, Button, ButtonLink, Skeleton, useToast } from "../../shared/design-system";
import { InvalidLink } from "../../shared/InvalidLink";
import { formatDate, toIsoDate } from "../../shared/utilities/dates";
import { useLinkSecret } from "../../shared/utilities/linkSecret";

/** Invitation tokens are base64url (docs/26 section 5.2); the API takes 20 to 100 characters. */
const looksLikeToken = (token: string) => /^[\w-]{20,100}$/.test(token);

export function InvitePage() {
  const { secret, clear } = useLinkSecret("invite");
  const { isSignedIn } = useAuth();

  if (!secret || !looksLikeToken(secret)) return <InvalidLink />;

  if (!isSignedIn) {
    return (
      <main className="tp-page">
        <div className="tp-card tp-stack">
          <h1>הוזמנת לסטודיו</h1>
          <p className="tp-muted">כדי לראות את ההזמנה ולאשר אותה, התחברו או הירשמו עם כתובת המייל שאליה נשלחה.</p>
          <SignInButtons returnTo="/invite" />
        </div>
      </main>
    );
  }

  return <Invitation token={secret} onUsed={clear} />;
}

function Invitation({ token, onUsed }: { token: string; onUsed: () => void }) {
  const api = useApi();
  const me = useMe();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  // Preview needs the account, so it waits for POST /session.
  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: () => unwrap(api.POST("/api/v1/invitations/preview", { body: { token } })),
    enabled: Boolean(me.data),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/invitations/accept", { body: { token } })),
    onSuccess: async (membership) => {
      onUsed();
      await queryClient.invalidateQueries({ queryKey: meKey });
      toast.show({ tone: "success", icon: "check", message: `הצטרפת ל${membership.organization.displayName}` });
      void navigate("/", { replace: true });
    },
  });

  // An unknown, expired or revoked invitation will not come back: forget the token.
  const gone = isGone(preview.error) || isGone(accept.error);
  useEffect(() => {
    if (gone) onUsed();
  }, [gone, onUsed]);

  const error = me.error ?? preview.error;
  if (error) {
    return (
      <main className="tp-page tp-stack">
        <Banner tone="danger" icon="info">
          {errorMessage(error, "לא הצלחנו לטעון את ההזמנה. נסו שוב.")}
        </Banner>
        <ButtonLink to="/" variant="secondary">
          לדף הבית
        </ButtonLink>
      </main>
    );
  }

  if (!preview.data) {
    return (
      <main className="tp-page" aria-busy="true">
        <span className="tp-sr-only">טוענים את ההזמנה…</span>
        <Skeleton height={220} />
      </main>
    );
  }

  const { organization, role, invitedByDisplayName, expiresAt } = preview.data;
  return (
    <main className="tp-page">
      <div className="tp-card tp-stack">
        <span className="tp-eyebrow">הזמנה</span>
        <h1>הוזמנת ל{organization.displayName}</h1>
        <p className="tp-muted">
          {invitedByDisplayName && <>הזמנה מאת {invitedByDisplayName} · </>}
          תפקיד: {roleName(role)} · בתוקף עד {formatDate(toIsoDate(new Date(expiresAt)))}
        </p>
        {accept.isError && (
          <Banner tone="danger" icon="info">
            {errorMessage(accept.error, "לא הצלחנו לאשר את ההזמנה. נסו שוב.")}
          </Banner>
        )}
        {hasCode(accept.error, "invitation.email_mismatch") ? (
          <Button block variant="secondary" onClick={() => client?.signOut()}>
            התחברות עם חשבון אחר
          </Button>
        ) : (
          !gone && (
            <Button block loading={accept.isPending} onClick={() => accept.mutate()}>
              אישור ההצטרפות
            </Button>
          )
        )}
        <ButtonLink to="/" variant="ghost" block>
          לא עכשיו
        </ButtonLink>
      </div>
    </main>
  );
}

function isGone(error: unknown): boolean {
  return error instanceof TempoApiError && (error.status === 404 || error.status === 410);
}

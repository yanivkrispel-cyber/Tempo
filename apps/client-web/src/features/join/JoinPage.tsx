import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TempoApiError, unwrap } from "@tempo/api-client";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { meKey, useMe } from "../../account/account";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { useAuth } from "../../auth/AuthProvider";
import { SignInButtons } from "../../auth/SignInButtons";
import { Banner, Button, ButtonLink, Skeleton, useToast } from "../../shared/design-system";
import { InvalidLink } from "../../shared/InvalidLink";
import { useLinkSecret } from "../../shared/utilities/linkSecret";

/** Join codes are base64url (docs/26 section 5.3); the API takes 16 to 64 characters. */
const looksLikeCode = (code: string) => /^[\w-]{16,64}$/.test(code);

const notFound = "הקישור לא תקין או שהוחלף בקישור חדש. בקשו מהסטודיו את הקישור העדכני.";

export function JoinPage() {
  const { secret, clear } = useLinkSecret("join");
  const { isSignedIn } = useAuth();

  if (!secret || !looksLikeCode(secret)) return <InvalidLink />;

  if (!isSignedIn) {
    return (
      <main className="tp-page">
        <div className="tp-card tp-stack">
          <h1>הצטרפות לסטודיו</h1>
          <p className="tp-muted">כדי להצטרף, התחברו או הירשמו.</p>
          <SignInButtons returnTo="/join" />
        </div>
      </main>
    );
  }

  return <Join code={secret} onUsed={clear} />;
}

function Join({ code, onUsed }: { code: string; onUsed: () => void }) {
  const api = useApi();
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  // Preview needs the account, so it waits for POST /session.
  const preview = useQuery({
    queryKey: ["join-preview", code],
    queryFn: () => unwrap(api.POST("/api/v1/join/preview", { body: { code } })),
    enabled: Boolean(me.data),
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/join", { body: { code } })),
    onSuccess: async (membership) => {
      onUsed();
      await queryClient.invalidateQueries({ queryKey: meKey });
      toast.show({ tone: "success", icon: "check", message: `הצטרפת ל${membership.organization.displayName}` });
      void navigate("/", { replace: true });
    },
  });

  // A replaced or unknown code will not come back: forget it.
  const gone = isNotFound(preview.error) || isNotFound(join.error);
  useEffect(() => {
    if (gone) onUsed();
  }, [gone, onUsed]);

  const error = me.error ?? preview.error;
  if (error) {
    return (
      <main className="tp-page tp-stack">
        <Banner tone="danger" icon="info">
          {isNotFound(error) ? notFound : errorMessage(error, "לא הצלחנו לטעון את פרטי הסטודיו. נסו שוב.")}
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
        <span className="tp-sr-only">טוענים את פרטי הסטודיו…</span>
        <Skeleton height={200} />
      </main>
    );
  }

  return (
    <main className="tp-page">
      <div className="tp-card tp-stack">
        <span className="tp-eyebrow">הצטרפות לסטודיו</span>
        <h1>הצטרפות ל{preview.data.organization.displayName}</h1>
        <p className="tp-muted">אחרי ההצטרפות אפשר לראות את מערכת השיעורים ולהירשם.</p>
        {join.isError && (
          <Banner tone="danger" icon="info">
            {isNotFound(join.error) ? notFound : errorMessage(join.error, "לא הצלחנו לצרף אותך. נסו שוב.")}
          </Banner>
        )}
        {!gone && (
          <Button block loading={join.isPending} onClick={() => join.mutate()}>
            הצטרפות
          </Button>
        )}
        <ButtonLink to="/" variant="ghost" block>
          לא עכשיו
        </ButtonLink>
      </div>
    </main>
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof TempoApiError && error.status === 404;
}

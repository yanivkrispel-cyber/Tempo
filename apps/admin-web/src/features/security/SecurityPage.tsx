import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accessTokenScopes,
  accountAdminScope,
  CognitoAccount,
  CognitoAccountError,
  cognitoRegion,
  otpauthUri,
  type AuthClient,
} from "@tempo/api-client/auth";
import { useMemo, useState, type FormEvent } from "react";
import { useAccount } from "../../account/account";
import { useAuth } from "../../auth/AuthProvider";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  cx,
  EmptyState,
  Field,
  Icon,
  Input,
  Skeleton,
  useToast,
} from "../../shared/design-system";
import { QrCode } from "./QrCode";
import styles from "./security.module.css";

export const securityPath = "/account/security";

const statusKey = ["account", "totp"] as const;

/** The name Cognito keeps for the authenticator, and the issuer the app shows next to the codes. */
const issuer = "Tempo";

/**
 * Cognito's user API for the signed-in user, or null when setup cannot run in this app: sign-in does not ask for
 * `aws.cognito.signin.user.admin` (VITE_COGNITO_MFA_SETUP is off), or the Hosted UI is on a custom domain, which does
 * not name the region. A token issued before the scope was asked for is refused here, before any call to Cognito.
 */
function useCognitoAccount(client: AuthClient | null): CognitoAccount | null {
  return useMemo(() => {
    const region = client ? cognitoRegion(client.config.cognitoDomain) : null;
    if (!client || !region || !(client.config.scopes ?? []).includes(accountAdminScope)) return null;
    return new CognitoAccount({
      region,
      getAccessToken: async () => {
        const token = await client.getAccessToken();
        if (token && !accessTokenScopes(token).includes(accountAdminScope)) {
          throw new CognitoAccountError("not_authorized", "The access token lacks the account scope.");
        }
        return token;
      },
    });
  }, [client]);
}

/** A sentence for the screen; never Cognito's English text. */
function cognitoMessage(error: unknown, fallback: string): string {
  if (!(error instanceof CognitoAccountError)) return fallback;
  switch (error.code) {
    case "code_mismatch":
      return "הקוד לא תואם. הקלידו את הקוד שמוצג עכשיו באפליקציה, ובדקו שהשעה בטלפון מכוונת אוטומטית.";
    case "too_many_requests":
      return "יותר מדי ניסיונות. חכו כמה דקות ונסו שוב.";
    case "not_authorized":
    case "signed_out":
      return "כדי לשנות את הגדרות האבטחה צריך להתחבר מחדש.";
    default:
      return fallback;
  }
}

const needsSignIn = (error: unknown) =>
  error instanceof CognitoAccountError && (error.code === "not_authorized" || error.code === "signed_out");

/** `/account/security`: two-step sign-in (TOTP) for the signed-in account (docs/27 section 3.6, A-5). */
export function SecurityPage() {
  const { client } = useAuth();
  const cognito = useCognitoAccount(client);

  return (
    <main className={cx("tp-page tp-stack", styles.page)}>
      <header className="tp-stack" style={{ gap: 4 }}>
        <div>
          <ButtonLink to="/" variant="ghost" size="sm" icon="chevron-right">
            חזרה לניהול
          </ButtonLink>
        </div>
        <span className="tp-eyebrow">החשבון שלך</span>
        <h1>אימות דו־שלבי</h1>
        <p className="tp-muted">
          בכל התחברות, אחרי הסיסמה, מקלידים גם קוד מאפליקציית אימות בטלפון. כך אף אחד לא נכנס לניהול הסטודיו רק עם
          הסיסמה שלך.
        </p>
      </header>

      {cognito ? (
        <TotpSetup cognito={cognito} />
      ) : (
        <EmptyState title="ההגדרה עוד לא זמינה כאן" titleAs="h2" icon="shield">
          הגדרת אימות דו־שלבי עדיין לא הופעלה בסביבה הזו. נסו שוב בקרוב, או פנו לצוות Tempo.
        </EmptyState>
      )}
    </main>
  );
}

function TotpSetup({ cognito }: { cognito: CognitoAccount }) {
  const me = useAccount();
  const [secret, setSecret] = useState<string | null>(null);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => cognito.totpStatus(),
    // Only a dropped connection may pass on a retry; a refused token or too many calls will not.
    retry: (failures, error) => failures < 1 && error instanceof CognitoAccountError && error.code === "failed",
  });
  const start = useMutation({ mutationFn: () => cognito.startTotp(), onSuccess: setSecret });

  if (status.isPending) {
    return (
      <div className="tp-stack" aria-busy="true">
        <span className="tp-sr-only">בודקים את הגדרות האבטחה…</span>
        <Skeleton height={160} />
      </div>
    );
  }

  if (status.isError) {
    return (
      <ProblemBanner
        error={status.error}
        fallback="לא הצלחנו לבדוק את הגדרות האבטחה. נסו שוב."
        onRetry={() => void status.refetch()}
      />
    );
  }

  if (secret) {
    return <Enroll cognito={cognito} secret={secret} account={me.email} onClose={() => setSecret(null)} />;
  }

  const enabled = status.data.enabled;
  return (
    <Card as="section" aria-labelledby="totp-state" className="tp-stack">
      <div className="tp-row">
        <Icon name={enabled ? "check" : "shield"} />
        <h2 id="totp-state">{enabled ? "אימות דו־שלבי פעיל" : "אימות דו־שלבי כבוי"}</h2>
      </div>
      <p className="tp-muted">
        {enabled
          ? "בכל התחברות נבקש קוד מאפליקציית האימות. החלפתם טלפון? הוסיפו את החשבון לאפליקציה החדשה."
          : "צריך אפליקציית אימות בטלפון, למשל Google Authenticator או Microsoft Authenticator. ההגדרה לוקחת כדקה."}
      </p>
      {start.isError && <ProblemBanner error={start.error} fallback="לא הצלחנו להתחיל את ההגדרה. נסו שוב." />}
      <div>
        <Button
          variant={enabled ? "secondary" : "primary"}
          icon={enabled ? "phone" : "shield"}
          loading={start.isPending}
          onClick={() => start.mutate()}
        >
          {enabled ? "העברה לאפליקציה אחרת" : "הפעלת אימות דו־שלבי"}
        </Button>
      </div>
    </Card>
  );
}

function Enroll({
  cognito,
  secret,
  account,
  onClose,
}: {
  cognito: CognitoAccount;
  secret: string;
  account: string;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const confirm = useMutation({
    mutationFn: (value: string) => cognito.confirmTotp(value, issuer),
    onSuccess: async () => {
      toast.show({ tone: "success", icon: "check", message: "אימות דו־שלבי הופעל" });
      onClose();
      // Everything: the TOTP status, and the account, whose next POST /session reads the new MFA setting, so
      // studio routes that answered auth.mfa_required are asked again.
      await queryClient.invalidateQueries();
    },
  });

  const digits = code.replace(/\s/g, "");
  const formatError = /^\d{6}$/.test(digits) ? null : "6 ספרות מהאפליקציה";
  const mismatch = confirm.error instanceof CognitoAccountError && confirm.error.code === "code_mismatch";
  const fieldError = submitted && formatError ? formatError : mismatch ? cognitoMessage(confirm.error, "") : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!formatError) confirm.mutate(digits);
  };

  return (
    <Card as="section" aria-labelledby="totp-enroll" className="tp-stack">
      <h2 id="totp-enroll">הוספת החשבון לאפליקציית האימות</h2>
      <ol className="tp-stack" style={{ gap: 4, paddingInlineStart: "1.25em" }}>
        <li>פתחו את אפליקציית האימות ובחרו בהוספת חשבון.</li>
        <li>סרקו את הקוד, או הקלידו את המפתח שלידו.</li>
        <li>הקלידו כאן את הקוד בן 6 הספרות שהאפליקציה מציגה.</li>
      </ol>

      <div className={styles.setup}>
        <QrCode value={otpauthUri({ issuer, account, secret })} label="קוד QR להוספת החשבון לאפליקציית האימות" />
        <div className="tp-stack" style={{ gap: 6 }}>
          <span className="tp-label" id="totp-secret-label">
            אי אפשר לסרוק? המפתח להקלדה:
          </span>
          <code className={styles.secret} dir="ltr" aria-labelledby="totp-secret-label">
            {secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <span className="tp-caption tp-muted">סוג: מבוסס זמן. אל תשתפו את המפתח עם אף אחד.</span>
        </div>
      </div>

      <form className="tp-stack" onSubmit={submit} noValidate>
        <Field label="הקוד מהאפליקציה" required help="הקוד מתחלף כל 30 שניות." error={fieldError}>
          <Input
            className={cx("tp-ltr", styles.code)}
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        {confirm.isError && !mismatch && (
          <ProblemBanner error={confirm.error} fallback="לא הצלחנו להפעיל את האימות. נסו שוב." />
        )}
        <div className="tp-row">
          <Button type="submit" icon="check" loading={confirm.isPending}>
            הפעלה
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={confirm.isPending}>
            ביטול
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** An error from Cognito: "sign in again" when the token cannot be used, otherwise a retry when one is offered. */
function ProblemBanner({ error, fallback, onRetry }: { error: unknown; fallback: string; onRetry?: () => void }) {
  const { client } = useAuth();
  const signIn = needsSignIn(error);
  return (
    <div className="tp-stack">
      <Banner tone={signIn ? "warning" : "danger"} icon="info">
        {cognitoMessage(error, fallback)}
      </Banner>
      {signIn ? (
        <div>
          <Button variant="secondary" icon="user" onClick={() => void client?.signIn(securityPath)}>
            התחברות מחדש
          </Button>
        </div>
      ) : (
        onRetry && (
          <div>
            <Button variant="secondary" onClick={onRetry}>
              ניסיון נוסף
            </Button>
          </div>
        )
      )}
    </div>
  );
}

import { CognitoSignInError, type CognitoTokens, type SignInStep } from "@tempo/api-client/auth";
import { useState, type FormEvent } from "react";
import { CodeField, EmailField, LinkButton, ResendButton, type SignInApi } from "../../auth/branded/BrandedSignIn";
import { PASSWORD_POLICY, signInErrorText } from "../../auth/branded/messages";
import { Banner, Button, Field, Input } from "../../shared/design-system";
import styles from "./public.module.css";

export type SheetSignUpApi = Pick<
  SignInApi,
  "signUp" | "confirmSignUp" | "signInAfterConfirm" | "passwordDirect" | "resendCode"
>;

/**
 * Sign-up inside "שריינו לי מקום" (board ב, SL-2): name, email and password, then the six digits from the email, and
 * the visitor is in without leaving the class page. The password goes once `EMAIL_OTP` can send the codes (#304,
 * docs/36 F-2). The password and the code live in this component's memory only (docs/36 T-4).
 */
export function SheetSignUp({
  cognito,
  onSignedIn,
  onSignIn,
}: {
  cognito: SheetSignUpApi;
  /** The tokens and the name typed here; the sheet adopts them, saves the name and joins the studio. */
  onSignedIn: (tokens: CognitoTokens, name: string) => Promise<void>;
  /** "כבר מתאמנים כאן? כניסה": the usual sign-in, back to the sheet afterwards. */
  onSignIn: () => void;
}) {
  const [step, setStep] = useState<{ name: "form" } | { name: "code"; session: string | null }>({ name: "form" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "danger" | "info"; text: string } | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>, onError: (error: CognitoSignInError) => void) => {
    setBusy(true);
    setNotice(null);
    setPasswordError(null);
    try {
      await work();
    } catch (error) {
      onError(error instanceof CognitoSignInError ? error : new CognitoSignInError("failed", "Unknown"));
    } finally {
      setBusy(false);
    }
  };

  const show = (error: CognitoSignInError) => setNotice({ tone: "danger", text: signInErrorText(error.code) });

  /** The button keeps spinning while the sheet sets the account up, until the page moves on. */
  const finish = async (signedIn: SignInStep) => {
    if (signedIn.kind !== "signed_in") throw new CognitoSignInError("failed", "Unexpected step");
    setPassword("");
    await onSignedIn(signedIn.tokens, name.trim());
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (step.name === "form") {
      return void run(
        async () => {
          const { session } = await cognito.signUp(email.trim(), password);
          setCode("");
          setStep({ name: "code", session });
        },
        (error) => {
          // A taken email reads exactly like a new one (docs/36 T-2).
          if (error.code === "username_exists") setStep({ name: "code", session: null });
          else if (error.code === "invalid_password") setPasswordError(PASSWORD_POLICY);
          else show(error);
        },
      );
    }
    void run(
      async () => {
        const { session } = await cognito.confirmSignUp(email.trim(), code, step.session);
        await finish(
          session
            ? await cognito.signInAfterConfirm(email.trim(), session)
            : await cognito.passwordDirect(email.trim(), password),
        );
      },
      (error) => {
        if (error.code === "code_expired") void cognito.resendCode(email.trim()).catch(() => undefined);
        show(error);
      },
    );
  };

  return (
    <form className={styles.sheetBody} onSubmit={onSubmit} noValidate>
      {step.name === "form" ? (
        <>
          <p className="tp-muted">שלושה פרטים וקוד למייל, ואתם בפנים. נרשמים כאן, משלמים בסטודיו.</p>
          <Field label="שם מלא">
            <Input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <EmailField value={email} onChange={setEmail} />
          <Field label="סיסמה" help={PASSWORD_POLICY} error={passwordError}>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              dir="ltr"
            />
          </Field>
          {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
          <Button type="submit" size="lg" block loading={busy} disabled={!name.trim() || !email.trim() || !password}>
            שלחו קוד ושריינו
          </Button>
          <LinkButton onClick={onSignIn}>כבר מתאמנים כאן? כניסה</LinkButton>
        </>
      ) : (
        <>
          <p className="tp-muted">
            אם האימייל פנוי, שלחנו אליו קוד בן שש ספרות (<bdi dir="ltr">{email.trim()}</bdi>).
          </p>
          <CodeField value={code} onChange={setCode} />
          {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
          <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>
            אישור ושריון
          </Button>
          <ResendButton
            key={notice?.text ?? "first"}
            disabled={busy}
            onResend={() =>
              void run(async () => {
                await cognito.resendCode(email.trim());
                setNotice({ tone: "info", text: "שלחנו קוד חדש." });
              }, show)
            }
          />
          <LinkButton onClick={() => setStep({ name: "form" })}>שינוי הפרטים</LinkButton>
        </>
      )}
    </form>
  );
}

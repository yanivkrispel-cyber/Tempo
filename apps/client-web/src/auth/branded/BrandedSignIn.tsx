import {
  CognitoSignInError,
  type CognitoSignIn,
  type CognitoSignInErrorCode,
  type CognitoTokens,
  type SignInFactor,
  type SignInStep,
} from "@tempo/api-client/auth";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isInAppBrowser } from "../../app/inAppBrowser";
import { Banner, Button, Field, Input } from "../../shared/design-system";
import { PASSWORD_POLICY, signInErrorText } from "./messages";
import styles from "./signin.module.css";

/** The calls the screen makes, so a test can hand it a fake Cognito. */
export type SignInApi = Pick<
  CognitoSignIn,
  | "passkeysSupported"
  | "start"
  | "password"
  | "passwordDirect"
  | "requestEmailCode"
  | "emailCode"
  | "totp"
  | "newPassword"
  | "passkey"
  | "signUp"
  | "confirmSignUp"
  | "signInAfterConfirm"
  | "resendCode"
  | "forgotPassword"
  | "confirmForgotPassword"
  | "registerPasskey"
>;

/** How the screen looks for one studio (docs/35); `/login` passes Tempo's own. */
export interface SignInBrand {
  name: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  /** One of the eight accents (`data-accent`); the page's own accent when absent. */
  accent?: string | null;
}

export interface BrandedSignInProps {
  brand: SignInBrand;
  cognito: SignInApi;
  initialView?: "email" | "signup";
  /** Gets the tokens once the person is in; the page adopts them and goes to `returnTo`. */
  onSignedIn: (tokens: CognitoTokens) => void;
  /** The usual sign-in through the Hosted UI. */
  onHostedUi: () => void;
  /** Where this device remembers its answer to the Face ID offer. */
  deviceStorage?: Storage;
}

/** This device's answer to the one-time Face ID offer: `registered`, `declined` or `failed`. Not a secret. */
export const PASSKEY_OFFER_KEY = "tempo.client-web.passkey-offer";

type Challenge = { username: string; session: string };

type View =
  | { name: "email" }
  | { name: "passkey"; challenge: Challenge; factors: SignInFactor[] }
  | { name: "password"; challenge: Challenge | null; factors: SignInFactor[] }
  | { name: "email_code"; challenge: Challenge }
  | { name: "totp"; challenge: Challenge }
  | { name: "new_password"; challenge: Challenge }
  | { name: "mfa_setup" }
  | { name: "signup" }
  | { name: "confirm"; session: string | null; sent: boolean }
  | { name: "forgot" }
  | { name: "reset" }
  | { name: "offer"; tokens: CognitoTokens };

interface Notice {
  tone: "danger" | "success" | "info";
  text: string;
  /** Adds the link to the usual sign-in, for an outage or a misconfiguration. */
  hostedUi?: boolean;
}

const RESEND_SECONDS = 60;

/**
 * Design B of the branded sign-in (docs/36): the studio's photo fills the screen and a glass sheet holds one step at
 * a time. The password, codes and Cognito `Session` strings live in this component's memory only; nothing here
 * logs or stores them (T-4, T-5).
 */
export function BrandedSignIn({
  brand,
  cognito,
  initialView = "email",
  onSignedIn,
  onHostedUi,
  deviceStorage,
}: BrandedSignInProps) {
  const [view, setView] = useState<View>(initialView === "signup" ? { name: "signup" } : { name: "email" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const usedPasskey = useRef(false);
  const offeredFactors = useRef<SignInFactor[]>([]);
  const storage = deviceStorage ?? safeLocalStorage();
  const formRef = useRef<HTMLFormElement>(null);
  const firstView = useRef(true);
  // Inside Instagram, Facebook or TikTok passkeys usually fail: only the code and the password there (SL-7).
  const passkeys = cognito.passkeysSupported && !isInAppBrowser();

  // Each new step takes the focus to its first field (or button), so a keyboard and a screen reader follow along.
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    formRef.current?.querySelector<HTMLElement>("input:not([hidden]), button")?.focus();
  }, [view.name]);

  const go = (next: View, nextNotice: Notice | null = null) => {
    setView(next);
    setNotice(nextNotice);
    setPasswordError(null);
    setCode("");
    setNewPassword("");
  };

  const finish = (tokens: CognitoTokens) => {
    setPassword("");
    onSignedIn(tokens);
  };

  /** Moves to whatever Cognito asked for next. */
  const apply = (step: SignInStep) => {
    switch (step.kind) {
      case "choose": {
        const challenge = challengeOf(step);
        offeredFactors.current = step.factors;
        if (step.factors.includes("WEB_AUTHN") && passkeys && readOffer(storage) !== "failed")
          go({ name: "passkey", challenge, factors: step.factors });
        else go({ name: "password", challenge, factors: step.factors });
        return;
      }
      case "password":
        return go({ name: "password", challenge: challengeOf(step), factors: offeredFactors.current });
      case "passkey":
        if (!passkeys) return go({ name: "password", challenge: challengeOf(step), factors: offeredFactors.current });
        return go({ name: "passkey", challenge: challengeOf(step), factors: offeredFactors.current });
      case "email_code":
        return go({ name: "email_code", challenge: challengeOf(step) });
      case "totp":
        return go({ name: "totp", challenge: challengeOf(step) });
      case "new_password":
        return go({ name: "new_password", challenge: challengeOf(step) });
      case "mfa_setup":
        return go({ name: "mfa_setup" });
      case "signed_in": {
        // Offered once per device, never to someone who has a passkey or just used one.
        const offer =
          passkeys &&
          !usedPasskey.current &&
          !offeredFactors.current.includes("WEB_AUTHN") &&
          readOffer(storage) === null;
        if (offer) go({ name: "offer", tokens: step.tokens });
        else finish(step.tokens);
        return;
      }
    }
  };

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

  /** The answer to an error every step shares; a step handles its own codes first. */
  const show = (code: CognitoSignInErrorCode) =>
    setNotice({ tone: "danger", text: signInErrorText(code), hostedUi: code === "failed" });

  const expired = () => go({ name: "email" }, { tone: "info", text: "עבר יותר מדי זמן. התחילו שוב." });

  const startReset = () =>
    run(
      async () => {
        await cognito.forgotPassword(email);
        go({ name: "reset" });
      },
      (error) => show(error.code),
    );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    switch (view.name) {
      case "email":
        return void run(
          async () => apply(await cognito.start(email.trim())),
          (error) => show(error.code),
        );
      case "password":
        return void run(
          async () =>
            apply(
              view.challenge
                ? await cognito.password(view.challenge, password)
                : await cognito.passwordDirect(email, password),
            ),
          (error) => {
            if (error.code === "not_confirmed") go({ name: "confirm", session: null, sent: false });
            else if (error.code === "reset_required") void startReset();
            else show(error.code);
          },
        );
      case "email_code":
      case "totp":
        return void run(
          async () =>
            apply(
              view.name === "totp"
                ? await cognito.totp(view.challenge, code)
                : await cognito.emailCode(view.challenge, code),
            ),
          (error) => (error.code === "not_authorized" ? expired() : show(error.code)),
        );
      case "new_password":
        return void run(
          async () => apply(await cognito.newPassword(view.challenge, newPassword)),
          (error) => {
            if (error.code === "not_authorized") expired();
            else if (error.code === "invalid_password") setPasswordError(PASSWORD_POLICY);
            else show(error.code);
          },
        );
      case "signup":
        return void run(
          async () => {
            const { session } = await cognito.signUp(email.trim(), password);
            go({ name: "confirm", session, sent: true });
          },
          (error) => {
            // A taken email reads exactly like a new one (T-2).
            if (error.code === "username_exists") go({ name: "confirm", session: null, sent: true });
            else if (error.code === "invalid_password") setPasswordError(PASSWORD_POLICY);
            else show(error.code);
          },
        );
      case "confirm":
        return void run(
          async () => {
            const { session } = await cognito.confirmSignUp(email, code, view.session);
            if (session) apply(await cognito.signInAfterConfirm(email, session));
            else if (password) apply(await cognito.passwordDirect(email, password));
            else
              go(
                { name: "password", challenge: null, factors: [] },
                { tone: "success", text: "האימייל אומת. היכנסו עם הסיסמה." },
              );
          },
          (error) => {
            if (error.code === "code_expired") {
              show(error.code);
              void cognito.resendCode(email).catch(() => undefined);
            } else if (error.code === "not_authorized")
              go(
                { name: "password", challenge: null, factors: [] },
                { tone: "success", text: "האימייל אומת. היכנסו עם הסיסמה." },
              );
            else show(error.code);
          },
        );
      case "forgot":
        return void startReset();
      case "reset":
        return void run(
          async () => {
            await cognito.confirmForgotPassword(email, code, newPassword);
            setPassword("");
            go(
              { name: "password", challenge: null, factors: [] },
              { tone: "success", text: "הסיסמה עודכנה. היכנסו איתה." },
            );
          },
          (error) => {
            if (error.code === "invalid_password") setPasswordError(PASSWORD_POLICY);
            else if (error.code === "code_expired") {
              show(error.code);
              void cognito.forgotPassword(email).catch(() => undefined);
            } else show(error.code);
          },
        );
      default:
        return;
    }
  };

  const signInWithPasskey = (challenge: Challenge, factors: SignInFactor[]) =>
    run(
      async () => {
        usedPasskey.current = true;
        apply(await cognito.passkey(challenge));
      },
      (error) => {
        usedPasskey.current = false;
        if (error.code === "passkey_cancelled") show(error.code);
        else if (error.code === "not_authorized") expired();
        else if (error.code === "passkey_failed") {
          // Quietly to the password; this device stops offering the passkey (docs/36 section 4.1).
          writeOffer(storage, "failed");
          go({ name: "password", challenge, factors });
        } else show(error.code);
      },
    );

  const answerOffer = (tokens: CognitoTokens, accept: boolean) => {
    if (!accept) {
      writeOffer(storage, "declined");
      return finish(tokens);
    }
    void run(
      async () => {
        await cognito.registerPasskey(tokens.accessToken);
        writeOffer(storage, "registered");
        finish(tokens);
      },
      () => {
        writeOffer(storage, "failed");
        finish(tokens);
      },
    );
  };

  const sendCode = (session: string | null) =>
    run(
      async () => {
        await cognito.resendCode(email);
        go({ name: "confirm", session, sent: true }, { tone: "info", text: "שלחנו קוד חדש." });
      },
      (error) => show(error.code),
    );

  const backToEmail = () => go({ name: "email" });
  const toSignIn = () => go({ name: "email" });

  return (
    <main className={styles.stage} data-accent={brand.accent ?? undefined}>
      {brand.coverUrl && <img className={styles.photo} src={brand.coverUrl} alt="" />}
      <header className={styles.brand}>
        {brand.logoUrl ? (
          <img className={styles.logo} src={brand.logoUrl} alt="" />
        ) : (
          <span className={styles.logo} aria-hidden="true">
            {brand.name.slice(0, 1)}
          </span>
        )}
        <p className={styles.studio}>{brand.name}</p>
      </header>

      <section className={`tp-glass ${styles.sheet}`} aria-live="polite">
        <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate>
          {view.name === "email" && (
            <>
              <Heading title="שמחים לראות אתכם" lead="היכנסו עם האימייל שלכם." />
              <EmailField value={email} onChange={setEmail} />
              <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
              <Button type="submit" block loading={busy} disabled={!email.trim()}>
                המשך
              </Button>
              <LinkButton onClick={() => go({ name: "signup" })}>אין לכם חשבון? להרשמה</LinkButton>
            </>
          )}

          {view.name === "passkey" && (
            <>
              <Heading title="כניסה מהירה" lead={email} ltrLead />
              <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
              <Button block loading={busy} onClick={() => void signInWithPasskey(view.challenge, view.factors)}>
                כניסה עם Face ID או טביעת אצבע
              </Button>
              <Button
                block
                variant="secondary"
                disabled={busy}
                onClick={() => go({ name: "password", challenge: view.challenge, factors: view.factors })}
              >
                כניסה עם סיסמה
              </Button>
              <LinkButton onClick={backToEmail}>החלפת אימייל</LinkButton>
            </>
          )}

          {view.name === "password" && (
            <>
              <Heading title="הסיסמה שלכם" lead={email} ltrLead />
              <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
              <Field label="סיסמה" error={passwordError}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  dir="ltr"
                />
              </Field>
              <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
              <Button type="submit" block loading={busy} disabled={!password}>
                כניסה
              </Button>
              {view.challenge && view.factors.includes("EMAIL_OTP") && (
                <Button
                  block
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => apply(await cognito.requestEmailCode(view.challenge!)),
                      (error) => (error.code === "not_authorized" ? expired() : show(error.code)),
                    )
                  }
                >
                  שלחו לי קוד במייל
                </Button>
              )}
              <div className={styles.links}>
                <LinkButton onClick={() => go({ name: "forgot" })}>שכחתי סיסמה</LinkButton>
                <LinkButton onClick={backToEmail}>החלפת אימייל</LinkButton>
              </div>
            </>
          )}

          {(view.name === "email_code" || view.name === "totp") && (
            <>
              {view.name === "totp" ? (
                <Heading title="קוד מאפליקציית האימות" lead="הקלידו את שש הספרות שמופיעות באפליקציה." />
              ) : (
                <Heading title="בדקו את המייל" lead={`שלחנו קוד בן שש ספרות אל ${email}.`} />
              )}
              <CodeField value={code} onChange={setCode} />
              <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
              <Button type="submit" block loading={busy} disabled={code.length !== 6}>
                אישור
              </Button>
              <LinkButton onClick={backToEmail}>התחלה מחדש</LinkButton>
            </>
          )}

          {view.name === "new_password" && (
            <>
              <Heading title="בחירת סיסמה חדשה" lead="החשבון צריך סיסמה חדשה לפני הכניסה." />
              <NewPasswordField value={newPassword} onChange={setNewPassword} error={passwordError} />
              <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
              <Button type="submit" block loading={busy} disabled={!newPassword}>
                שמירה וכניסה
              </Button>
            </>
          )}

          {view.name === "mfa_setup" && (
            <>
              <Heading title="נדרש אימות דו־שלבי" lead="כדי להגדיר אותו, ממשיכים בעמוד הכניסה הרגיל. זה לוקח דקה." />
              <Button block onClick={onHostedUi}>
                המשך להגדרה
              </Button>
              <LinkButton onClick={backToEmail}>חזרה</LinkButton>
            </>
          )}

          {view.name === "signup" && (
            <>
              <Heading title="הרשמה" lead="אימייל וסיסמה, ואז קוד קצר שנשלח למייל." />
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
              <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
              <Button type="submit" block loading={busy} disabled={!email.trim() || !password}>
                יצירת חשבון
              </Button>
              <LinkButton onClick={toSignIn}>כבר יש לכם חשבון? כניסה</LinkButton>
            </>
          )}

          {view.name === "confirm" && (
            <>
              {view.sent ? (
                <Heading title="אימות האימייל" lead={`אם האימייל פנוי, שלחנו אליו קוד בן שש ספרות (${email}).`} />
              ) : (
                <Heading title="אימות האימייל" lead="החשבון עוד לא אומת. נשלח קוד בן שש ספרות למייל שלכם." />
              )}
              {view.sent ? (
                <>
                  <CodeField value={code} onChange={setCode} />
                  <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
                  <Button type="submit" block loading={busy} disabled={code.length !== 6}>
                    אישור
                  </Button>
                  <ResendButton
                    key={notice?.text ?? "first"}
                    onResend={() => void sendCode(view.session)}
                    disabled={busy}
                  />
                </>
              ) : (
                <>
                  <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
                  <Button block loading={busy} onClick={() => void sendCode(view.session)}>
                    שלחו קוד
                  </Button>
                </>
              )}
              <LinkButton onClick={toSignIn}>חזרה לכניסה</LinkButton>
            </>
          )}

          {view.name === "forgot" && (
            <>
              <Heading title="איפוס סיסמה" lead="נשלח קוד למייל, ואיתו תבחרו סיסמה חדשה." />
              <EmailField value={email} onChange={setEmail} />
              <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
              <Button type="submit" block loading={busy} disabled={!email.trim()}>
                שליחת קוד
              </Button>
              <LinkButton onClick={toSignIn}>חזרה לכניסה</LinkButton>
            </>
          )}

          {view.name === "reset" && (
            <>
              <Heading title="סיסמה חדשה" lead={`אם יש חשבון עם האימייל הזה, שלחנו אליו קוד (${email}).`} />
              <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
              <CodeField value={code} onChange={setCode} />
              <NewPasswordField value={newPassword} onChange={setNewPassword} error={passwordError} />
              <NoticeBanner notice={notice} onHostedUi={onHostedUi} />
              <Button type="submit" block loading={busy} disabled={code.length !== 6 || !newPassword}>
                שמירת הסיסמה
              </Button>
              <LinkButton onClick={toSignIn}>חזרה לכניסה</LinkButton>
            </>
          )}

          {view.name === "offer" && (
            <>
              <Heading title="בפעם הבאה, בלי סיסמה" lead="אפשר להיכנס עם Face ID או טביעת אצבע במכשיר הזה." />
              <Button block loading={busy} onClick={() => answerOffer(view.tokens, true)}>
                הפעלה
              </Button>
              <Button block variant="secondary" disabled={busy} onClick={() => answerOffer(view.tokens, false)}>
                לא עכשיו
              </Button>
            </>
          )}
        </form>

        {view.name !== "offer" && (
          <footer className={styles.footer}>
            <LinkButton onClick={onHostedUi}>כניסה בדרך הרגילה</LinkButton>
            <span className={styles.built}>נבנה עם Tempo</span>
          </footer>
        )}
      </section>
    </main>
  );
}

function Heading({ title, lead, ltrLead = false }: { title: string; lead: string; ltrLead?: boolean }) {
  return (
    <div className={styles.heading}>
      <h1 className={styles.title}>{title}</h1>
      {/* An email reads left to right but stays on the page's right edge. */}
      <p className="tp-muted">{ltrLead ? <bdi dir="ltr">{lead}</bdi> : lead}</p>
    </div>
  );
}

export function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="אימייל">
      <Input
        type="email"
        inputMode="email"
        autoComplete="username email"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        dir="ltr"
      />
    </Field>
  );
}

/**
 * Six digits shown as six boxes. One real input sits over the boxes, so the phone still offers the code from the SMS
 * or mail bar, a paste fills all six, and anything but digits is dropped.
 */
export function CodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="קוד בן שש ספרות">
      <div className={styles.codeBoxes} dir="ltr">
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className={styles.codeBox}
            data-filled={index < value.length || undefined}
            data-current={index === Math.min(value.length, 5) || undefined}
            aria-hidden="true"
          >
            {value[index] ?? ""}
          </span>
        ))}
        <Input
          className={styles.codeInput}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
          dir="ltr"
        />
      </div>
    </Field>
  );
}

function NewPasswordField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  return (
    <Field label="סיסמה חדשה" help={PASSWORD_POLICY} error={error}>
      <Input
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        dir="ltr"
      />
    </Field>
  );
}

function NoticeBanner({ notice, onHostedUi }: { notice: Notice | null; onHostedUi: () => void }) {
  if (!notice) return null;
  return (
    <Banner tone={notice.tone} icon={notice.tone === "success" ? "check" : "info"}>
      {notice.text}
      {notice.hostedUi && (
        <>
          {" "}
          <LinkButton onClick={onHostedUi}>כניסה בדרך הרגילה</LinkButton>
        </>
      )}
    </Banner>
  );
}

export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={styles.link} onClick={onClick}>
      {children}
    </button>
  );
}

/** "Send again" opens after 60 seconds (docs/36 section 4). */
export function ResendButton({ onResend, disabled }: { onResend: () => void; disabled: boolean }) {
  const [left, setLeft] = useState(RESEND_SECONDS);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return (
    <button type="button" className={styles.link} onClick={onResend} disabled={disabled || left > 0}>
      {left > 0 ? `שלחו שוב בעוד ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "שלחו שוב"}
    </button>
  );
}

function challengeOf(step: Challenge): Challenge {
  return { username: step.username, session: step.session };
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readOffer(storage: Storage | null): string | null {
  try {
    return storage?.getItem(PASSKEY_OFFER_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeOffer(storage: Storage | null, value: "registered" | "declined" | "failed"): void {
  try {
    storage?.setItem(PASSKEY_OFFER_KEY, value);
  } catch {
    // A device that cannot remember is asked again next time; nothing else depends on it.
  }
}

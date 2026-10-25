import { CognitoSignInError, type CognitoSignInErrorCode, type CognitoTokens } from "@tempo/api-client/auth";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../../test/auth";
import { BrandedSignIn, PASSKEY_OFFER_KEY, type SignInApi } from "./BrandedSignIn";

const email = "noga@example.com";
const password = "Correct-Horse-9";
const challenge = { username: email, session: "session-1" };
const tokens: CognitoTokens = { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600 };
const signedIn = { kind: "signed_in", tokens } as const;

function fail(code: CognitoSignInErrorCode, type = "SomeException") {
  return vi.fn().mockRejectedValue(new CognitoSignInError(code, type));
}

function fakeCognito(overrides: Partial<SignInApi> = {}): SignInApi {
  return {
    passkeysSupported: false,
    start: vi.fn().mockResolvedValue({ kind: "choose", ...challenge, factors: ["PASSWORD"] }),
    password: vi.fn().mockResolvedValue(signedIn),
    passwordDirect: vi.fn().mockResolvedValue(signedIn),
    requestEmailCode: vi.fn().mockResolvedValue({ kind: "email_code", ...challenge }),
    emailCode: vi.fn().mockResolvedValue(signedIn),
    totp: vi.fn().mockResolvedValue(signedIn),
    newPassword: vi.fn().mockResolvedValue(signedIn),
    passkey: vi.fn().mockResolvedValue(signedIn),
    signUp: vi.fn().mockResolvedValue({ session: "signup-session" }),
    confirmSignUp: vi.fn().mockResolvedValue({ session: "confirm-session" }),
    signInAfterConfirm: vi.fn().mockResolvedValue(signedIn),
    resendCode: vi.fn().mockResolvedValue(undefined),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    confirmForgotPassword: vi.fn().mockResolvedValue(undefined),
    registerPasskey: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function setup(
  cognito: SignInApi,
  { initialView, deviceStorage = memoryStorage() }: { initialView?: "email" | "signup"; deviceStorage?: Storage } = {},
) {
  const onSignedIn = vi.fn();
  const onHostedUi = vi.fn();
  const user = userEvent.setup();
  render(
    <BrandedSignIn
      brand={{ name: "סטודיו נשימה", accent: "terracotta", coverUrl: "https://cdn.example.com/cover.jpg" }}
      cognito={cognito}
      initialView={initialView}
      onSignedIn={onSignedIn}
      onHostedUi={onHostedUi}
      deviceStorage={deviceStorage}
    />,
  );
  return { user, onSignedIn, onHostedUi, deviceStorage };
}

async function enterEmail(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("אימייל"), email);
  await user.click(screen.getByRole("button", { name: "המשך" }));
}

async function enterPassword(user: ReturnType<typeof userEvent.setup>, value = password) {
  await user.type(await screen.findByLabelText("סיסמה"), value);
  await user.click(screen.getByRole("button", { name: "כניסה" }));
}

async function enterCode(user: ReturnType<typeof userEvent.setup>, code = "123456") {
  await user.type(await screen.findByLabelText("קוד בן שש ספרות"), code);
}

describe("BrandedSignIn: the studio's look", () => {
  it("shows the studio's name, accent and cover photo, and the way back to the usual sign-in", async () => {
    const { user, onHostedUi } = setup(fakeCognito());
    expect(screen.getByText("סטודיו נשימה")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("data-accent", "terracotta");
    expect(document.querySelector("img[src='https://cdn.example.com/cover.jpg']")).not.toBeNull();
    expect(screen.getByText(/נבנה עם Tempo/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "כניסה בדרך הרגילה" }));
    expect(onHostedUi).toHaveBeenCalledOnce();
  });

  it("asks for an email the way a phone keyboard and a password manager expect", () => {
    setup(fakeCognito());
    const field = screen.getByLabelText("אימייל");
    expect(field).toHaveAttribute("type", "email");
    expect(field).toHaveAttribute("autocomplete", "username");
    expect(field).toHaveAttribute("inputmode", "email");
  });
});

describe("BrandedSignIn: signing in", () => {
  it("signs in with the password and hands over the tokens", async () => {
    const cognito = fakeCognito();
    const { user, onSignedIn } = setup(cognito);
    await enterEmail(user);
    expect(cognito.start).toHaveBeenCalledWith(email);
    expect(screen.getByLabelText("סיסמה")).toHaveAttribute("autocomplete", "current-password");
    await enterPassword(user);
    expect(cognito.password).toHaveBeenCalledWith(challenge, password);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
  });

  it("shows one text for a wrong password and an unknown email, and stays on the step", async () => {
    const { user, onSignedIn } = setup(fakeCognito({ password: fail("not_authorized", "NotAuthorizedException") }));
    await enterEmail(user);
    await enterPassword(user);
    expect(await screen.findByText("האימייל או הסיסמה לא נכונים.")).toBeInTheDocument();
    expect(screen.getByLabelText("סיסמה")).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("offers Face ID first when the email has it and the device can, and signs in with it", async () => {
    const cognito = fakeCognito({
      passkeysSupported: true,
      start: vi.fn().mockResolvedValue({ kind: "choose", ...challenge, factors: ["PASSWORD", "WEB_AUTHN"] }),
    });
    const { user, onSignedIn, deviceStorage } = setup(cognito);
    await enterEmail(user);
    await user.click(await screen.findByRole("button", { name: "כניסה עם Face ID או טביעת אצבע" }));
    expect(cognito.passkey).toHaveBeenCalledWith(challenge);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
    // Signed in with a passkey: nothing to offer.
    expect(deviceStorage.getItem(PASSKEY_OFFER_KEY)).toBeNull();
  });

  it("falls back to the password quietly when the passkey path fails, and stops offering it here", async () => {
    const cognito = fakeCognito({
      passkeysSupported: true,
      start: vi.fn().mockResolvedValue({ kind: "choose", ...challenge, factors: ["PASSWORD", "WEB_AUTHN"] }),
      passkey: fail("passkey_failed", "WebAuthnRelyingPartyMismatchException"),
    });
    const { user, deviceStorage } = setup(cognito);
    await enterEmail(user);
    await user.click(await screen.findByRole("button", { name: "כניסה עם Face ID או טביעת אצבע" }));
    expect(await screen.findByLabelText("סיסמה")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(deviceStorage.getItem(PASSKEY_OFFER_KEY)).toBe("failed");
  });

  it("stays on the Face ID step when the person cancels it, with the password one tap away", async () => {
    const cognito = fakeCognito({
      passkeysSupported: true,
      start: vi.fn().mockResolvedValue({ kind: "choose", ...challenge, factors: ["PASSWORD", "WEB_AUTHN"] }),
      passkey: fail("passkey_cancelled", "NotAllowedError"),
    });
    const { user } = setup(cognito);
    await enterEmail(user);
    await user.click(await screen.findByRole("button", { name: "כניסה עם Face ID או טביעת אצבע" }));
    expect(await screen.findByText(/הכניסה המהירה בוטלה/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "כניסה עם סיסמה" }));
    expect(await screen.findByLabelText("סיסמה")).toBeInTheDocument();
  });

  it("asks for the authenticator app's six digits", async () => {
    const cognito = fakeCognito({ password: vi.fn().mockResolvedValue({ kind: "totp", ...challenge }) });
    const { user, onSignedIn } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    const code = await screen.findByLabelText("קוד בן שש ספרות");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    await user.type(code, "12 34-56");
    expect(code).toHaveValue("123456");
    await user.click(screen.getByRole("button", { name: "אישור" }));
    expect(cognito.totp).toHaveBeenCalledWith(challenge, "123456");
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
  });

  it("says a wrong code without leaving the step", async () => {
    const cognito = fakeCognito({
      password: vi.fn().mockResolvedValue({ kind: "totp", ...challenge }),
      totp: fail("code_mismatch", "CodeMismatchException"),
    });
    const { user } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    await enterCode(user);
    await user.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByText("הקוד לא נכון. בדקו ונסו שוב.")).toBeInTheDocument();
  });

  it("goes back to the email when the sign-in session expired", async () => {
    const cognito = fakeCognito({
      password: vi.fn().mockResolvedValue({ kind: "totp", ...challenge }),
      totp: fail("not_authorized", "NotAuthorizedException"),
    });
    const { user } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    await enterCode(user);
    await user.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByText("עבר יותר מדי זמן. התחילו שוב.")).toBeInTheDocument();
    expect(screen.getByLabelText("אימייל")).toHaveValue(email);
  });

  it("asks for a new password when the account needs one", async () => {
    const cognito = fakeCognito({ password: vi.fn().mockResolvedValue({ kind: "new_password", ...challenge }) });
    const { user, onSignedIn } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    const field = await screen.findByLabelText("סיסמה חדשה");
    expect(field).toHaveAttribute("autocomplete", "new-password");
    await user.type(field, "New-Password-12");
    await user.click(screen.getByRole("button", { name: "שמירה וכניסה" }));
    expect(cognito.newPassword).toHaveBeenCalledWith(challenge, "New-Password-12");
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
  });

  it("sends a two-step setup to the usual sign-in page", async () => {
    const cognito = fakeCognito({ password: vi.fn().mockResolvedValue({ kind: "mfa_setup", ...challenge }) });
    const { user, onHostedUi } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    await user.click(await screen.findByRole("button", { name: "המשך להגדרה" }));
    expect(onHostedUi).toHaveBeenCalledOnce();
  });

  it("signs in with a code by email when the pool offers it", async () => {
    const cognito = fakeCognito({
      start: vi.fn().mockResolvedValue({ kind: "choose", ...challenge, factors: ["PASSWORD", "EMAIL_OTP"] }),
    });
    const { user, onSignedIn } = setup(cognito);
    await enterEmail(user);
    await user.click(await screen.findByRole("button", { name: "שלחו לי קוד במייל" }));
    expect(cognito.requestEmailCode).toHaveBeenCalledWith(challenge);
    await enterCode(user, "654321");
    await user.click(screen.getByRole("button", { name: "אישור" }));
    expect(cognito.emailCode).toHaveBeenCalledWith(challenge, "654321");
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
  });

  it.each([
    ["too_many_attempts", "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות."],
    ["invalid_parameter", "בדקו את הפרטים ונסו שוב."],
    ["delivery_failed", "לא הצלחנו לשלוח קוד. נסו שוב."],
  ] as const)("shows %s as one Hebrew text", async (code, text) => {
    const { user } = setup(fakeCognito({ start: fail(code) }));
    await enterEmail(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("offers the usual sign-in page when Cognito or the network fails", async () => {
    const { user, onHostedUi } = setup(fakeCognito({ start: fail("failed", "NetworkError") }));
    await enterEmail(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("משהו השתבש. אפשר להיכנס גם בדרך הרגילה.");
    await user.click(screen.getAllByRole("button", { name: "כניסה בדרך הרגילה" })[0]!);
    expect(onHostedUi).toHaveBeenCalledOnce();
  });
});

describe("BrandedSignIn: the one-time Face ID offer", () => {
  const passkeyDevice = () => fakeCognito({ passkeysSupported: true });

  it("offers Face ID once after a password sign-in and registers it", async () => {
    const cognito = passkeyDevice();
    const { user, onSignedIn, deviceStorage } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    await user.click(await screen.findByRole("button", { name: "הפעלה" }));
    expect(cognito.registerPasskey).toHaveBeenCalledWith("access-1");
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
    expect(deviceStorage.getItem(PASSKEY_OFFER_KEY)).toBe("registered");
  });

  it("remembers a 'not now' on this device and does not ask again", async () => {
    const cognito = passkeyDevice();
    const { user, onSignedIn, deviceStorage } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    await user.click(await screen.findByRole("button", { name: "לא עכשיו" }));
    expect(onSignedIn).toHaveBeenCalledWith(tokens);
    expect(cognito.registerPasskey).not.toHaveBeenCalled();
    expect(deviceStorage.getItem(PASSKEY_OFFER_KEY)).toBe("declined");
  });

  it("does not offer again on a device that already answered", async () => {
    const deviceStorage = memoryStorage({ [PASSKEY_OFFER_KEY]: "declined" });
    const { user, onSignedIn } = setup(passkeyDevice(), { deviceStorage });
    await enterEmail(user);
    await enterPassword(user);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
    expect(screen.queryByRole("button", { name: "הפעלה" })).not.toBeInTheDocument();
  });

  it("still signs in when registering the passkey fails", async () => {
    const cognito = fakeCognito({
      passkeysSupported: true,
      registerPasskey: fail("passkey_cancelled", "NotAllowedError"),
    });
    const { user, onSignedIn, deviceStorage } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    await user.click(await screen.findByRole("button", { name: "הפעלה" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
    expect(deviceStorage.getItem(PASSKEY_OFFER_KEY)).toBe("failed");
  });
});

describe("BrandedSignIn: signing up", () => {
  async function signUp(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("אימייל"), email);
    const field = screen.getByLabelText("סיסמה");
    expect(field).toHaveAttribute("autocomplete", "new-password");
    await user.type(field, password);
    await user.click(screen.getByRole("button", { name: "יצירת חשבון" }));
  }

  it("signs up, confirms the six digits and signs in with the Cognito session", async () => {
    const cognito = fakeCognito();
    const { user, onSignedIn } = setup(cognito, { initialView: "signup" });
    expect(screen.getByText(/לפחות 12 תווים/)).toBeInTheDocument();
    await signUp(user);
    expect(cognito.signUp).toHaveBeenCalledWith(email, password);
    expect(await screen.findByText(/אם האימייל פנוי, שלחנו אליו קוד/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /שלחו שוב בעוד/ })).toBeDisabled();
    await enterCode(user);
    await user.click(screen.getByRole("button", { name: "אישור" }));
    expect(cognito.confirmSignUp).toHaveBeenCalledWith(email, "123456", "signup-session");
    expect(cognito.signInAfterConfirm).toHaveBeenCalledWith(email, "confirm-session");
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
  });

  it("keeps the email in the code step's line reading left to right inside the Hebrew sentence", async () => {
    const { user } = setup(fakeCognito(), { initialView: "signup" });
    await signUp(user);
    const lead = await screen.findByText(/אם האימייל פנוי, שלחנו אליו קוד/);
    const isolated = within(lead).getByText(email);
    expect(isolated.tagName).toBe("BDI");
    expect(isolated).toHaveAttribute("dir", "ltr");
  });

  it("answers a taken email exactly like a new one", async () => {
    const { user } = setup(fakeCognito({ signUp: fail("username_exists", "UsernameExistsException") }), {
      initialView: "signup",
    });
    await signUp(user);
    expect(await screen.findByText(/אם האימייל פנוי, שלחנו אליו קוד/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains the password policy under the field", async () => {
    const { user } = setup(fakeCognito({ signUp: fail("invalid_password", "InvalidPasswordException") }), {
      initialView: "signup",
    });
    await signUp(user);
    expect(await screen.findByLabelText("סיסמה")).toHaveAccessibleDescription(
      "לפחות 12 תווים, עם אות גדולה ואות קטנה באנגלית, ספרה וסימן.",
    );
  });

  it("sends a new code when the old one expired", async () => {
    const cognito = fakeCognito({ confirmSignUp: fail("code_expired", "ExpiredCodeException") });
    const { user } = setup(cognito, { initialView: "signup" });
    await signUp(user);
    await enterCode(user);
    await user.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByText("הקוד פג. שלחנו קוד חדש.")).toBeInTheDocument();
    expect(cognito.resendCode).toHaveBeenCalledWith(email);
  });

  it("takes an unconfirmed account from the password step to the confirmation, then signs in", async () => {
    const cognito = fakeCognito({
      password: fail("not_confirmed", "UserNotConfirmedException"),
      confirmSignUp: vi.fn().mockResolvedValue({ session: null }),
    });
    const { user, onSignedIn } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    expect(await screen.findByText(/החשבון עוד לא אומת/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "שלחו קוד" }));
    expect(cognito.resendCode).toHaveBeenCalledWith(email);
    await enterCode(user);
    await user.click(screen.getByRole("button", { name: "אישור" }));
    expect(cognito.confirmSignUp).toHaveBeenCalledWith(email, "123456", null);
    expect(cognito.passwordDirect).toHaveBeenCalledWith(email, password);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
  });
});

describe("BrandedSignIn: a forgotten password", () => {
  it("sends a code, sets the new password and signs in with it", async () => {
    const cognito = fakeCognito();
    const { user, onSignedIn } = setup(cognito);
    await enterEmail(user);
    await user.click(await screen.findByRole("button", { name: "שכחתי סיסמה" }));
    await user.click(screen.getByRole("button", { name: "שליחת קוד" }));
    expect(cognito.forgotPassword).toHaveBeenCalledWith(email);
    expect(await screen.findByText(/אם יש חשבון עם האימייל הזה, שלחנו אליו קוד/)).toBeInTheDocument();
    await enterCode(user);
    await user.type(screen.getByLabelText("סיסמה חדשה"), "New-Password-12");
    await user.click(screen.getByRole("button", { name: "שמירת הסיסמה" }));
    expect(cognito.confirmForgotPassword).toHaveBeenCalledWith(email, "123456", "New-Password-12");
    expect(await screen.findByText("הסיסמה עודכנה. היכנסו איתה.")).toBeInTheDocument();
    await enterPassword(user, "New-Password-12");
    expect(cognito.passwordDirect).toHaveBeenCalledWith(email, "New-Password-12");
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
  });

  it("starts the reset when Cognito requires one", async () => {
    const cognito = fakeCognito({ password: fail("reset_required", "PasswordResetRequiredException") });
    const { user } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    expect(await screen.findByText(/אם יש חשבון עם האימייל הזה, שלחנו אליו קוד/)).toBeInTheDocument();
    expect(cognito.forgotPassword).toHaveBeenCalledWith(email);
  });
});

describe("BrandedSignIn: what it keeps on the device", () => {
  const hostile = '<script>alert(1)</script> "x"';

  it("shows the studio's name as text, never as markup", () => {
    render(
      <BrandedSignIn brand={{ name: hostile }} cognito={fakeCognito()} onSignedIn={vi.fn()} onHostedUi={vi.fn()} />,
    );
    expect(document.body.textContent).toContain(hostile);
    expect(document.body.querySelector("script")).toBeNull();
  });

  it("never writes the password, a code or a token to web storage or a cookie", async () => {
    const writes: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      writes.push(`${key}=${value}`);
    });
    const deviceWrites: string[] = [];
    const cookies: string[] = [];
    const cookie = vi.spyOn(document, "cookie", "set").mockImplementation((value) => void cookies.push(value));
    try {
      // Password sign-in.
      const first = setup(fakeCognito());
      await enterEmail(first.user);
      await enterPassword(first.user);
      await waitFor(() => expect(first.onSignedIn).toHaveBeenCalledWith(tokens));
      document.body.replaceChildren();

      // Sign-up, then the emailed code.
      const second = setup(fakeCognito(), { initialView: "signup" });
      await second.user.type(screen.getByLabelText("אימייל"), email);
      await second.user.type(screen.getByLabelText("סיסמה"), password);
      await second.user.click(screen.getByRole("button", { name: "יצירת חשבון" }));
      await enterCode(second.user);
      await second.user.click(screen.getByRole("button", { name: "אישור" }));
      await waitFor(() => expect(second.onSignedIn).toHaveBeenCalledWith(tokens));
      for (const { deviceStorage } of [first, second]) {
        for (let i = 0; i < deviceStorage.length; i++) {
          const key = deviceStorage.key(i)!;
          deviceWrites.push(`${key}=${deviceStorage.getItem(key)}`);
        }
      }
    } finally {
      setItem.mockRestore();
      cookie.mockRestore();
    }
    const secrets = [password, "123456", tokens.accessToken, tokens.refreshToken, "session-1"];
    for (const line of [...writes, ...cookies, ...deviceWrites])
      for (const secret of secrets) expect(line).not.toContain(secret);
    expect(cookies).toEqual([]);
  });
});

describe("BrandedSignIn: inside Instagram, Facebook or TikTok (SL-7)", () => {
  const instagram =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.27.80";
  afterEach(() => vi.restoreAllMocks());

  it("goes straight to the password, though the email has a passkey and the phone could use it", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(instagram);
    const cognito = fakeCognito({
      passkeysSupported: true,
      start: vi.fn().mockResolvedValue({ kind: "choose", ...challenge, factors: ["PASSWORD", "WEB_AUTHN"] }),
    });
    const { user, onSignedIn } = setup(cognito);
    await enterEmail(user);
    expect(screen.queryByRole("button", { name: "כניסה עם Face ID או טביעת אצבע" })).not.toBeInTheDocument();
    await enterPassword(user);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
    expect(cognito.passkey).not.toHaveBeenCalled();
  });

  it("takes the password when Cognito asks for the passkey first", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(instagram);
    const cognito = fakeCognito({
      passkeysSupported: true,
      start: vi.fn().mockResolvedValue({ kind: "passkey", ...challenge, options: {} }),
    });
    const { user } = setup(cognito);
    await enterEmail(user);
    expect(await screen.findByLabelText("סיסמה")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "כניסה עם Face ID או טביעת אצבע" })).not.toBeInTheDocument();
  });

  it("does not offer Face ID after the sign-in", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(instagram);
    const cognito = fakeCognito({ passkeysSupported: true });
    const { user, onSignedIn, deviceStorage } = setup(cognito);
    await enterEmail(user);
    await enterPassword(user);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(tokens));
    expect(screen.queryByRole("button", { name: "הפעלה" })).not.toBeInTheDocument();
    expect(deviceStorage.getItem(PASSKEY_OFFER_KEY)).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { CognitoSignIn, CognitoSignInError, type CognitoSignInErrorCode } from "./cognitoSignIn";

type Answer = { status?: number; body: unknown };

/** A fake Cognito: each target answers from a queue (or one fixed answer), and every call is recorded. */
function stub(answers: Record<string, Answer | Answer[]>) {
  const calls: { target: string; body: Record<string, unknown>; url: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const target = String(new Headers(init?.headers).get("X-Amz-Target")).split(".").pop()!;
    calls.push({ target, body: JSON.parse(String(init?.body)), url: String(input) });
    const entry = answers[target];
    const answer = (Array.isArray(entry) ? entry.shift() : entry) ?? {
      status: 400,
      body: { __type: "InvalidParameterException" },
    };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return { fetch, calls };
}

const tokens = { AuthenticationResult: { AccessToken: "acc", RefreshToken: "ref", IdToken: "id", ExpiresIn: 3600 } };
const signedIn = { kind: "signed_in", tokens: { accessToken: "acc", refreshToken: "ref", expiresIn: 3600 } };
const fail = (type: string): Answer => ({ status: 400, body: { __type: `com.amazonaws#${type}` } });

const client = (fetch: typeof globalThis.fetch, credentials?: Pick<CredentialsContainer, "get" | "create">) =>
  new CognitoSignIn({ region: "eu-central-1", clientId: "client-1", fetch, credentials });

const email = "dana@example.com";
const step = { username: "user-uuid", session: "s1" };

describe("CognitoSignIn sign-in", () => {
  it("starts USER_AUTH with the email and lists the factors", async () => {
    const { fetch, calls } = stub({
      InitiateAuth: {
        body: {
          ChallengeName: "SELECT_CHALLENGE",
          Session: "s1",
          AvailableChallenges: ["PASSWORD", "WEB_AUTHN", "PASSWORD_SRP"],
          ChallengeParameters: { USERNAME: "user-uuid" },
        },
      },
    });
    expect(await client(fetch).start(email)).toEqual({
      kind: "choose",
      username: "user-uuid",
      session: "s1",
      factors: ["PASSWORD", "WEB_AUTHN"],
    });
    expect(calls[0]).toMatchObject({
      url: "https://cognito-idp.eu-central-1.amazonaws.com/",
      body: { AuthFlow: "USER_AUTH", ClientId: "client-1", AuthParameters: { USERNAME: email } },
    });
  });

  it("signs in with the password in one answer", async () => {
    const { fetch, calls } = stub({ RespondToAuthChallenge: { body: tokens } });
    expect(await client(fetch).password(step, "Secret-pass-1")).toEqual(signedIn);
    expect(calls[0]!.body).toMatchObject({
      ChallengeName: "SELECT_CHALLENGE",
      Session: "s1",
      ChallengeResponses: { USERNAME: "user-uuid", ANSWER: "PASSWORD", PASSWORD: "Secret-pass-1" },
    });
  });

  it("answers a separate PASSWORD challenge when Cognito asks for one", async () => {
    const { fetch, calls } = stub({
      RespondToAuthChallenge: [{ body: { ChallengeName: "PASSWORD", Session: "s2" } }, { body: tokens }],
    });
    expect(await client(fetch).password(step, "Secret-pass-1")).toEqual(signedIn);
    expect(calls[1]!.body).toMatchObject({ ChallengeName: "PASSWORD", Session: "s2" });
  });

  it("signs in with the password directly", async () => {
    const { fetch, calls } = stub({ InitiateAuth: { body: tokens } });
    expect(await client(fetch).passwordDirect(email, "Secret-pass-1")).toEqual(signedIn);
    expect(calls[0]!.body.AuthParameters).toEqual({
      USERNAME: email,
      PREFERRED_CHALLENGE: "PASSWORD",
      PASSWORD: "Secret-pass-1",
    });
  });

  it("goes to the TOTP step and answers it", async () => {
    const { fetch, calls } = stub({
      RespondToAuthChallenge: [{ body: { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s2" } }, { body: tokens }],
    });
    const next = await client(fetch).password(step, "Secret-pass-1");
    expect(next).toEqual({ kind: "totp", username: "user-uuid", session: "s2" });
    expect(await client(fetch).totp(next as typeof step, "123456")).toEqual(signedIn);
    expect(calls[1]!.body).toMatchObject({
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      ChallengeResponses: { SOFTWARE_TOKEN_MFA_CODE: "123456" },
    });
  });

  it("maps NEW_PASSWORD_REQUIRED, MFA_SETUP, SELECT_MFA_TYPE and EMAIL_OTP to their steps", async () => {
    for (const [name, kind] of [
      ["NEW_PASSWORD_REQUIRED", "new_password"],
      ["MFA_SETUP", "mfa_setup"],
      ["SELECT_MFA_TYPE", "mfa_setup"],
      ["EMAIL_OTP", "email_code"],
    ] as const) {
      const { fetch } = stub({ RespondToAuthChallenge: { body: { ChallengeName: name, Session: "s2" } } });
      expect((await client(fetch).password(step, "x")).kind).toBe(kind);
    }
  });

  it("answers NEW_PASSWORD_REQUIRED with the new password", async () => {
    const { fetch, calls } = stub({ RespondToAuthChallenge: { body: tokens } });
    await client(fetch).newPassword(step, "New-pass-12345");
    expect(calls[0]!.body).toMatchObject({
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      ChallengeResponses: { NEW_PASSWORD: "New-pass-12345" },
    });
  });

  it("refuses a challenge it does not know", async () => {
    const { fetch } = stub({ InitiateAuth: { body: { ChallengeName: "CUSTOM_CHALLENGE" } } });
    await expect(client(fetch).start(email)).rejects.toMatchObject({ code: "failed" });
  });
});

describe("CognitoSignIn sign-up and reset", () => {
  it("passes SignUp's Session to ConfirmSignUp and signs in with the one it returns", async () => {
    const { fetch, calls } = stub({
      SignUp: { body: { UserConfirmed: false, Session: "su1" } },
      ConfirmSignUp: { body: { Session: "su2" } },
      InitiateAuth: { body: tokens },
    });
    const c = client(fetch);
    const { session } = await c.signUp(email, "Secret-pass-1");
    const confirmed = await c.confirmSignUp(email, "654321", session);
    expect(await c.signInAfterConfirm(email, confirmed.session!)).toEqual(signedIn);
    expect(calls.map((call) => call.target)).toEqual(["SignUp", "ConfirmSignUp", "InitiateAuth"]);
    expect(calls[0]!.body.UserAttributes).toEqual([{ Name: "email", Value: email }]);
    expect(calls[1]!.body).toMatchObject({ ConfirmationCode: "654321", Session: "su1" });
    expect(calls[2]!.body).toMatchObject({ AuthFlow: "USER_AUTH", Session: "su2" });
  });

  it("sends resend, forgot and confirm-forgot with the client id", async () => {
    const { fetch, calls } = stub({
      ResendConfirmationCode: { body: {} },
      ForgotPassword: { body: {} },
      ConfirmForgotPassword: { body: {} },
    });
    const c = client(fetch);
    await c.resendCode(email);
    await c.forgotPassword(email);
    await c.confirmForgotPassword(email, "111222", "New-pass-12345");
    expect(calls.map((call) => call.body.ClientId)).toEqual(["client-1", "client-1", "client-1"]);
    expect(calls[2]!.body).toMatchObject({ ConfirmationCode: "111222", Password: "New-pass-12345" });
  });
});

describe("CognitoSignIn errors (docs/36 section 4.1)", () => {
  const cases: [string, CognitoSignInErrorCode][] = [
    ["NotAuthorizedException", "not_authorized"],
    ["UserNotFoundException", "not_authorized"],
    ["UserNotConfirmedException", "not_confirmed"],
    ["PasswordResetRequiredException", "reset_required"],
    ["CodeMismatchException", "code_mismatch"],
    ["ExpiredCodeException", "code_expired"],
    ["UsernameExistsException", "username_exists"],
    ["AliasExistsException", "username_exists"],
    ["InvalidPasswordException", "invalid_password"],
    ["InvalidParameterException", "invalid_parameter"],
    ["LimitExceededException", "too_many_attempts"],
    ["TooManyRequestsException", "too_many_attempts"],
    ["TooManyFailedAttemptsException", "too_many_attempts"],
    ["CodeDeliveryFailureException", "delivery_failed"],
    ["WebAuthnNotSupportedException", "passkey_failed"],
    ["WebAuthnChallengeNotFoundException", "passkey_failed"],
    ["WebAuthnRelyingPartyMismatchException", "passkey_failed"],
    ["WebAuthnOriginNotAllowedException", "passkey_failed"],
    ["WebAuthnCredentialNotSupportedException", "passkey_failed"],
    ["WebAuthnConfigurationMissingException", "passkey_failed"],
    ["WebAuthnClientMismatchException", "passkey_failed"],
    ["WebAuthnNotEnabledException", "passkey_failed"],
    ["UserLambdaValidationException", "failed"],
    ["ResourceNotFoundException", "failed"],
    ["InternalErrorException", "failed"],
  ];

  it.each(cases)("maps %s to %s", async (type, code) => {
    const { fetch } = stub({ InitiateAuth: fail(type) });
    const error = await client(fetch)
      .start(email)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CognitoSignInError);
    expect(error).toMatchObject({ code, type });
  });

  it("reports a network error as failed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("offline");
    });
    await expect(client(fetch).start(email)).rejects.toMatchObject({ code: "failed", type: "NetworkError" });
  });

  it("never puts the password or a code in an error", async () => {
    const { fetch } = stub({
      RespondToAuthChallenge: fail("NotAuthorizedException"),
      ConfirmSignUp: fail("CodeMismatchException"),
    });
    const errors: unknown[] = [
      await client(fetch)
        .password(step, "Secret-pass-1")
        .catch((e: Error) => e),
      await client(fetch)
        .confirmSignUp(email, "654321", null)
        .catch((e: Error) => e),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(CognitoSignInError);
      const e = error as CognitoSignInError;
      expect(`${e.message} ${e.stack ?? ""}`).not.toMatch(/Secret-pass-1|654321|dana@example\.com/);
    }
  });
});

describe("CognitoSignIn passkeys", () => {
  const b64 = (text: string) => btoa(text).replace(/=+$/, "");
  const bytes = (text: string) => new TextEncoder().encode(text).buffer;

  afterEach(() => vi.unstubAllGlobals());

  function assertion(): PublicKeyCredential {
    return {
      id: "cred-1",
      rawId: bytes("cred-1"),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: bytes("cdj"),
        authenticatorData: bytes("ad"),
        signature: bytes("sig"),
        userHandle: bytes("uh"),
      },
    } as unknown as PublicKeyCredential;
  }

  it("runs the WebAuthn challenge and answers with the assertion", async () => {
    vi.stubGlobal("PublicKeyCredential", class {});
    const options = {
      challenge: b64("chal"),
      rpId: "tempo-members.pages.dev",
      allowCredentials: [{ id: b64("cred-1"), type: "public-key" }],
    };
    const { fetch, calls } = stub({
      RespondToAuthChallenge: [
        {
          body: {
            ChallengeName: "WEB_AUTHN",
            Session: "s2",
            ChallengeParameters: { CREDENTIAL_REQUEST_OPTIONS: JSON.stringify(options) },
          },
        },
        { body: tokens },
      ],
    });
    const get = vi.fn(async (_: CredentialRequestOptions) => assertion() as Credential);
    expect(await client(fetch, { get, create: vi.fn() }).passkey(step)).toEqual(signedIn);

    const publicKey = get.mock.calls[0]![0].publicKey!;
    expect(new TextDecoder().decode(publicKey.challenge as ArrayBuffer)).toBe("chal");
    expect(publicKey.rpId).toBe("tempo-members.pages.dev");
    expect(calls[0]!.body.ChallengeResponses).toMatchObject({ ANSWER: "WEB_AUTHN" });
    expect(calls[1]!.body).toMatchObject({ ChallengeName: "WEB_AUTHN", Session: "s2" });
    const credential = JSON.parse((calls[1]!.body.ChallengeResponses as Record<string, string>).CREDENTIAL!);
    expect(credential).toMatchObject({ id: "cred-1", rawId: b64("cred-1"), response: { signature: b64("sig") } });
  });

  it("turns a cancelled Face ID into passkey_cancelled", async () => {
    vi.stubGlobal("PublicKeyCredential", class {});
    const { fetch } = stub({
      RespondToAuthChallenge: {
        body: {
          ChallengeName: "WEB_AUTHN",
          Session: "s2",
          ChallengeParameters: { CREDENTIAL_REQUEST_OPTIONS: JSON.stringify({ challenge: b64("c") }) },
        },
      },
    });
    const get = vi.fn(async () => {
      throw new DOMException("cancelled", "NotAllowedError");
    });
    await expect(client(fetch, { get, create: vi.fn() }).passkey(step)).rejects.toMatchObject({
      code: "passkey_cancelled",
    });
  });

  it("registers a passkey with the access token", async () => {
    vi.stubGlobal("PublicKeyCredential", class {});
    const { fetch, calls } = stub({
      StartWebAuthnRegistration: {
        body: {
          CredentialCreationOptions: {
            challenge: b64("c"),
            rp: { id: "tempo-members.pages.dev", name: "Tempo" },
            user: { id: b64("u"), name: email, displayName: email },
            pubKeyCredParams: [],
          },
        },
      },
      CompleteWebAuthnRegistration: { body: {} },
    });
    const create = vi.fn(
      async () =>
        ({
          id: "cred-2",
          rawId: bytes("cred-2"),
          type: "public-key",
          authenticatorAttachment: "platform",
          getClientExtensionResults: () => ({}),
          response: { clientDataJSON: bytes("cdj"), attestationObject: bytes("ao"), getTransports: () => ["internal"] },
        }) as unknown as Credential,
    );
    await client(fetch, { get: vi.fn(), create }).registerPasskey("acc");
    expect(calls.map((call) => call.body.AccessToken)).toEqual(["acc", "acc"]);
    expect(calls[1]!.body.Credential).toMatchObject({
      id: "cred-2",
      response: { attestationObject: b64("ao"), transports: ["internal"] },
    });
  });
});

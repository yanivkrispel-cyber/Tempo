import { assertionToJson, attestationToJson, creationOptionsFromJson, requestOptionsFromJson } from "./webauthn";

/**
 * The members app's own sign-in screen talks to Cognito's public user-pool API from the browser (docs/36, ADR-0028):
 * choice-based sign-in (`USER_AUTH`), sign-up with an emailed code, forgot password, the TOTP step and passkeys.
 *
 * Nothing here logs or stores anything. Passwords, codes and `Session` strings are passed in and out; the caller keeps
 * them in component state only, and hands the final tokens to `AuthClient.adopt`. Errors keep only Cognito's
 * exception name (`__type`), never a request body (threat T-5).
 */

export type CognitoSignInErrorCode =
  /** Wrong password, unknown email (Cognito answers the same) or an expired `Session`. */
  | "not_authorized"
  /** Signed up but never confirmed the email: go to the six digits, with a resend. */
  | "not_confirmed"
  /** An administrator reset the password: go to forgot-password. */
  | "reset_required"
  | "code_mismatch"
  | "code_expired"
  /** Sign-up with a taken email. The screen answers as for a new one, so it never tells that the email exists. */
  | "username_exists"
  /** The password does not meet the pool's policy. */
  | "invalid_password"
  | "invalid_parameter"
  /** Cognito's rate limits or lockout. */
  | "too_many_attempts"
  | "delivery_failed"
  /** The passkey path failed on Cognito's side; the screen falls back to the password quietly. */
  | "passkey_failed"
  /** The person cancelled Face ID or the fingerprint (`NotAllowedError`), or the browser has no passkeys. */
  | "passkey_cancelled"
  /** Misconfiguration, an outage or offline: the screen offers the Hosted UI path. */
  | "failed";

export class CognitoSignInError extends Error {
  constructor(
    readonly code: CognitoSignInErrorCode,
    /** Cognito's exception name, for diagnosis. Never contains user input. */
    readonly type: string,
  ) {
    super(`Cognito sign-in: ${type}`);
    this.name = "CognitoSignInError";
  }
}

export interface CognitoTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds. */
  expiresIn: number;
}

export type SignInFactor = "PASSWORD" | "WEB_AUTHN" | "EMAIL_OTP";

/** Where a sign-in stands after each call. `session` is Cognito's opaque `Session`, valid for a few minutes. */
export type SignInStep =
  /** After the email: the factors this user may use. */
  | { kind: "choose"; username: string; session: string; factors: SignInFactor[] }
  | { kind: "password"; username: string; session: string }
  | { kind: "passkey"; username: string; session: string; options: Record<string, unknown> }
  | { kind: "email_code"; username: string; session: string }
  /** Owners and staff with an authenticator app (L-6). */
  | { kind: "totp"; username: string; session: string }
  /** An account an administrator created: the person sets a password first. */
  | { kind: "new_password"; username: string; session: string }
  /** The pool asks this user to set up MFA. The screen sends them to the Hosted UI, which can. */
  | { kind: "mfa_setup"; username: string; session: string }
  | { kind: "signed_in"; tokens: CognitoTokens };

export interface CognitoSignInOptions {
  /** The pool's AWS region, e.g. `eu-central-1`. */
  region: string;
  /** The members app client: a public client, no secret. */
  clientId: string;
  fetch?: typeof globalThis.fetch;
  /** `navigator.credentials`, replaceable in tests. */
  credentials?: Pick<CredentialsContainer, "get" | "create">;
}

interface AuthResponse {
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
  AvailableChallenges?: string[];
  AuthenticationResult?: { AccessToken?: string; RefreshToken?: string; ExpiresIn?: number };
}

const factors: readonly SignInFactor[] = ["PASSWORD", "WEB_AUTHN", "EMAIL_OTP"];

const errorCodes: Record<string, CognitoSignInErrorCode> = {
  NotAuthorizedException: "not_authorized",
  UserNotFoundException: "not_authorized",
  UserNotConfirmedException: "not_confirmed",
  PasswordResetRequiredException: "reset_required",
  CodeMismatchException: "code_mismatch",
  ExpiredCodeException: "code_expired",
  UsernameExistsException: "username_exists",
  AliasExistsException: "username_exists",
  InvalidPasswordException: "invalid_password",
  InvalidParameterException: "invalid_parameter",
  LimitExceededException: "too_many_attempts",
  TooManyRequestsException: "too_many_attempts",
  TooManyFailedAttemptsException: "too_many_attempts",
  CodeDeliveryFailureException: "delivery_failed",
};

function codeFor(type: string): CognitoSignInErrorCode {
  if (type.startsWith("WebAuthn")) return "passkey_failed";
  return errorCodes[type] ?? "failed";
}

export class CognitoSignIn {
  private readonly endpoint: string;
  private readonly clientId: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly credentials: Pick<CredentialsContainer, "get" | "create"> | undefined;

  constructor(options: CognitoSignInOptions) {
    this.endpoint = `https://cognito-idp.${options.region}.amazonaws.com/`;
    this.clientId = options.clientId;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.credentials = options.credentials ?? (typeof navigator !== "undefined" ? navigator.credentials : undefined);
  }

  /** Whether this browser can use a passkey at all. */
  get passkeysSupported(): boolean {
    return this.credentials !== undefined && typeof PublicKeyCredential !== "undefined";
  }

  /** The email step: `InitiateAuth` `USER_AUTH` with no preferred factor. */
  async start(email: string): Promise<SignInStep> {
    return this.toStep(
      email,
      await this.call<AuthResponse>("InitiateAuth", {
        AuthFlow: "USER_AUTH",
        ClientId: this.clientId,
        AuthParameters: { USERNAME: email },
      }),
    );
  }

  /**
   * The password, after `choose`. Cognito may answer `SELECT_CHALLENGE` + `ANSWER=PASSWORD` either with tokens or
   * with a `PASSWORD` challenge that wants the password again; both shapes end the same way.
   */
  async password(step: { username: string; session: string }, password: string): Promise<SignInStep> {
    const first = await this.respond(step, "SELECT_CHALLENGE", { ANSWER: "PASSWORD", PASSWORD: password });
    if (first.ChallengeName !== "PASSWORD") return this.toStep(step.username, first);
    return this.toStep(
      step.username,
      await this.respond({ ...step, session: first.Session ?? step.session }, "PASSWORD", { PASSWORD: password }),
    );
  }

  /** "Use a password" without the email step first: `InitiateAuth` with `PREFERRED_CHALLENGE: PASSWORD`. */
  async passwordDirect(email: string, password: string): Promise<SignInStep> {
    return this.toStep(
      email,
      await this.call<AuthResponse>("InitiateAuth", {
        AuthFlow: "USER_AUTH",
        ClientId: this.clientId,
        AuthParameters: { USERNAME: email, PREFERRED_CHALLENGE: "PASSWORD", PASSWORD: password },
      }),
    );
  }

  /** Asks Cognito for an email code (after #304, docs/36 F-2). */
  async requestEmailCode(step: { username: string; session: string }): Promise<SignInStep> {
    return this.toStep(step.username, await this.respond(step, "SELECT_CHALLENGE", { ANSWER: "EMAIL_OTP" }));
  }

  async emailCode(step: { username: string; session: string }, code: string): Promise<SignInStep> {
    return this.toStep(step.username, await this.respond(step, "EMAIL_OTP", { EMAIL_OTP_CODE: code }));
  }

  async totp(step: { username: string; session: string }, code: string): Promise<SignInStep> {
    return this.toStep(
      step.username,
      await this.respond(step, "SOFTWARE_TOKEN_MFA", { SOFTWARE_TOKEN_MFA_CODE: code }),
    );
  }

  async newPassword(step: { username: string; session: string }, password: string): Promise<SignInStep> {
    return this.toStep(step.username, await this.respond(step, "NEW_PASSWORD_REQUIRED", { NEW_PASSWORD: password }));
  }

  /**
   * Face ID or the fingerprint, from `choose`: asks Cognito for the passkey challenge, runs it in the browser, and
   * answers it. A cancel throws `passkey_cancelled`; any Cognito passkey error throws `passkey_failed`.
   */
  async passkey(step: { username: string; session: string }): Promise<SignInStep> {
    const challenge = await this.toStep(
      step.username,
      await this.respond(step, "SELECT_CHALLENGE", { ANSWER: "WEB_AUTHN" }),
    );
    if (challenge.kind !== "passkey") return challenge;
    const credential = await this.runCredential(() =>
      this.credentials!.get({ publicKey: requestOptionsFromJson(challenge.options) }),
    );
    return this.toStep(
      step.username,
      await this.respond(challenge, "WEB_AUTHN", { CREDENTIAL: JSON.stringify(assertionToJson(credential)) }),
    );
  }

  /** Sign-up: Cognito emails a six-digit code. Returns the `Session` that `confirmSignUp` passes on (F-6). */
  async signUp(email: string, password: string): Promise<{ session: string | null }> {
    const response = await this.call<{ Session?: string }>("SignUp", {
      ClientId: this.clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    });
    return { session: response.Session ?? null };
  }

  /** The six digits after sign-up. The returned `Session` signs the user in with `signInAfterConfirm`. */
  async confirmSignUp(email: string, code: string, session: string | null): Promise<{ session: string | null }> {
    const response = await this.call<{ Session?: string }>("ConfirmSignUp", {
      ClientId: this.clientId,
      Username: email,
      ConfirmationCode: code,
      ...(session ? { Session: session } : {}),
    });
    return { session: response.Session ?? null };
  }

  /** Straight in after the confirmation, without asking for the password again (docs/36 F-6). */
  async signInAfterConfirm(email: string, session: string): Promise<SignInStep> {
    return this.toStep(
      email,
      await this.call<AuthResponse>("InitiateAuth", {
        AuthFlow: "USER_AUTH",
        ClientId: this.clientId,
        AuthParameters: { USERNAME: email },
        Session: session,
      }),
    );
  }

  async resendCode(email: string): Promise<void> {
    await this.call("ResendConfirmationCode", { ClientId: this.clientId, Username: email });
  }

  async forgotPassword(email: string): Promise<void> {
    await this.call("ForgotPassword", { ClientId: this.clientId, Username: email });
  }

  async confirmForgotPassword(email: string, code: string, password: string): Promise<void> {
    await this.call("ConfirmForgotPassword", {
      ClientId: this.clientId,
      Username: email,
      ConfirmationCode: code,
      Password: password,
    });
  }

  /** The one-time Face ID offer after a sign-in: registers a passkey with the user's own access token. */
  async registerPasskey(accessToken: string): Promise<void> {
    const started = await this.call<{ CredentialCreationOptions?: Record<string, unknown> }>(
      "StartWebAuthnRegistration",
      { AccessToken: accessToken },
    );
    if (!started.CredentialCreationOptions) throw new CognitoSignInError("passkey_failed", "NoCreationOptions");
    const options = started.CredentialCreationOptions;
    const credential = await this.runCredential(() =>
      this.credentials!.create({ publicKey: creationOptionsFromJson(options) }),
    );
    await this.call("CompleteWebAuthnRegistration", {
      AccessToken: accessToken,
      Credential: attestationToJson(credential),
    });
  }

  private async runCredential(run: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
    if (!this.passkeysSupported) throw new CognitoSignInError("passkey_cancelled", "WebAuthnUnavailable");
    let credential: Credential | null;
    try {
      credential = await run();
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new CognitoSignInError(
        name === "NotAllowedError" || name === "AbortError" ? "passkey_cancelled" : "passkey_failed",
        name || "CredentialError",
      );
    }
    if (!credential) throw new CognitoSignInError("passkey_cancelled", "NoCredential");
    return credential as PublicKeyCredential;
  }

  private respond(
    step: { username: string; session: string },
    challenge: string,
    responses: Record<string, string>,
  ): Promise<AuthResponse> {
    return this.call<AuthResponse>("RespondToAuthChallenge", {
      ClientId: this.clientId,
      ChallengeName: challenge,
      Session: step.session,
      ChallengeResponses: { USERNAME: step.username, ...responses },
    });
  }

  private toStep(email: string, response: AuthResponse): SignInStep {
    const result = response.AuthenticationResult;
    if (result?.AccessToken && result.RefreshToken) {
      return {
        kind: "signed_in",
        tokens: {
          accessToken: result.AccessToken,
          refreshToken: result.RefreshToken,
          expiresIn: result.ExpiresIn ?? 3600,
        },
      };
    }
    // Cognito names the user in its own terms (the alias resolves to the user's internal name); answer with that.
    const username = response.ChallengeParameters?.USERNAME ?? email;
    const session = response.Session ?? "";
    switch (response.ChallengeName) {
      case "SELECT_CHALLENGE":
        return {
          kind: "choose",
          username,
          session,
          factors: (response.AvailableChallenges ?? []).filter((name): name is SignInFactor =>
            factors.includes(name as SignInFactor),
          ),
        };
      case "PASSWORD":
      case "PASSWORD_SRP":
        return { kind: "password", username, session };
      case "WEB_AUTHN": {
        const raw = response.ChallengeParameters?.CREDENTIAL_REQUEST_OPTIONS ?? "{}";
        let options: Record<string, unknown>;
        try {
          options = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new CognitoSignInError("passkey_failed", "BadRequestOptions");
        }
        return { kind: "passkey", username, session, options };
      }
      case "EMAIL_OTP":
        return { kind: "email_code", username, session };
      case "SOFTWARE_TOKEN_MFA":
        return { kind: "totp", username, session };
      case "NEW_PASSWORD_REQUIRED":
        return { kind: "new_password", username, session };
      case "MFA_SETUP":
      case "SELECT_MFA_TYPE":
        return { kind: "mfa_setup", username, session };
      default:
        throw new CognitoSignInError("failed", `UnexpectedChallenge:${response.ChallengeName ?? "none"}`);
    }
  }

  private async call<T>(action: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new CognitoSignInError("failed", "NetworkError");
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return payload as T;
    // `__type` is the exception name, sometimes with a namespace prefix: `...#NotAuthorizedException`.
    const type =
      String(payload.__type ?? "")
        .split("#")
        .pop() || `Http${response.status}`;
    throw new CognitoSignInError(codeFor(type), type);
  }
}

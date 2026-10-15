/**
 * Two-step sign-in (TOTP) setup against Cognito's user API, called from the browser with the user's own access token
 * (docs/27 section 3.6, A-5). Cognito answers these calls only when the token carries the
 * `aws.cognito.signin.user.admin` scope, so the app client must allow it and the app must ask for it at sign-in.
 *
 * The flow: AssociateSoftwareToken gives a secret, the user adds it to an authenticator app (QR code or the key by
 * hand), VerifySoftwareToken checks the first code, and SetUserMFAPreference turns TOTP on as the preferred method.
 */
export const accountAdminScope = "aws.cognito.signin.user.admin";

export type CognitoAccountErrorCode =
  /** The code the user typed does not match (wrong or expired). */
  | "code_mismatch"
  /** The access token lacks `aws.cognito.signin.user.admin`, or Cognito rejected it. */
  | "not_authorized"
  /** Too many attempts; try again later. */
  | "too_many_requests"
  /** Signed out: there is no access token to send. */
  | "signed_out"
  /** Offline, or Cognito answered something else. */
  | "failed";

export class CognitoAccountError extends Error {
  constructor(
    readonly code: CognitoAccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CognitoAccountError";
  }
}

export interface TotpStatus {
  /** TOTP is set up: Cognito lists `SOFTWARE_TOKEN_MFA` in the user's MFA settings. */
  enabled: boolean;
}

export interface CognitoAccountOptions {
  /** The pool's AWS region, e.g. `eu-central-1`. */
  region: string;
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}

/** The region from a Cognito prefix domain (`https://<prefix>.auth.<region>.amazoncognito.com`); null for a custom domain. */
export function cognitoRegion(cognitoDomain: string): string | null {
  return /\.auth\.([a-z]{2}(?:-[a-z]+)+-\d)\.amazoncognito\.com\/?$/.exec(cognitoDomain)?.[1] ?? null;
}

/** A JWT's claims, unverified; empty when it cannot be read. */
function claimsOf(accessToken: string): Record<string, unknown> {
  try {
    const payload = accessToken.split(".")[1] ?? "";
    const json = atob(
      payload
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(payload.length / 4) * 4, "="),
    );
    const claims: unknown = JSON.parse(json);
    return typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The scopes an access token was issued with, from its `scope` claim. For the screen only (to tell "sign in again"
 * from "not available"); Cognito checks the token itself.
 */
export function accessTokenScopes(accessToken: string): string[] {
  const scope = claimsOf(accessToken).scope;
  return typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
}

/**
 * When the user last typed their password (and MFA code, if on), in epoch milliseconds, from the token's `auth_time`
 * claim; null when it cannot be read. A refresh keeps it, so it tells how recent the sign-in is (docs/27 section 3.6).
 */
export function accessTokenAuthTime(accessToken: string): number | null {
  const authTime = claimsOf(accessToken).auth_time;
  return typeof authTime === "number" && Number.isFinite(authTime) ? authTime * 1000 : null;
}

/** The `otpauth://` URI an authenticator app reads from the QR code (Google Authenticator key URI format). */
export function otpauthUri({ issuer, account, secret }: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export class CognitoAccount {
  private readonly endpoint: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(options: CognitoAccountOptions) {
    this.endpoint = `https://cognito-idp.${options.region}.amazonaws.com/`;
    this.getAccessToken = options.getAccessToken;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** GetUser: whether TOTP is set up. */
  async totpStatus(): Promise<TotpStatus> {
    const user = await this.call<{ UserMFASettingList?: string[] }>("GetUser", {});
    return { enabled: (user.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA") };
  }

  /** AssociateSoftwareToken: a new TOTP secret (base32) for the authenticator app. Replaces any unverified one. */
  async startTotp(): Promise<string> {
    const response = await this.call<{ SecretCode?: string }>("AssociateSoftwareToken", {});
    if (!response.SecretCode) throw new CognitoAccountError("failed", "Cognito returned no secret.");
    return response.SecretCode;
  }

  /** VerifySoftwareToken with the first code, then SetUserMFAPreference: TOTP on and preferred. */
  async confirmTotp(code: string, deviceName: string): Promise<void> {
    const verified = await this.call<{ Status?: string }>("VerifySoftwareToken", {
      UserCode: code,
      FriendlyDeviceName: deviceName,
    });
    if (verified.Status !== "SUCCESS") throw new CognitoAccountError("code_mismatch", "The code does not match.");
    await this.call("SetUserMFAPreference", { SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } });
  }

  private async call<T>(action: string, body: Record<string, unknown>): Promise<T> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) throw new CognitoAccountError("signed_out", "No access token.");
    let response: Response;
    try {
      response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
        },
        body: JSON.stringify({ AccessToken: accessToken, ...body }),
      });
    } catch {
      throw new CognitoAccountError("failed", "Cognito could not be reached.");
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return payload as T;
    // `__type` is the exception name, sometimes with a namespace prefix: `...#NotAuthorizedException`.
    const type =
      String(payload.__type ?? "")
        .split("#")
        .pop() ?? "";
    const code: CognitoAccountErrorCode =
      type === "CodeMismatchException" || type === "EnableSoftwareTokenMFAException"
        ? "code_mismatch"
        : type === "NotAuthorizedException"
          ? "not_authorized"
          : type === "TooManyRequestsException" || type === "LimitExceededException"
            ? "too_many_requests"
            : "failed";
    throw new CognitoAccountError(code, `${action}: ${type || response.status}`);
  }
}

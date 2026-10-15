import { describe, expect, it, vi } from "vitest";
import { accessTokenScopes, CognitoAccount, CognitoAccountError, cognitoRegion, otpauthUri } from "./cognitoAccount";

const jwt = (payload: Record<string, unknown>) =>
  `e30.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.sig`;

function stub(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: { target: string; body: Record<string, unknown>; url: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const target = String(new Headers(init?.headers).get("X-Amz-Target")).split(".").pop()!;
    calls.push({ target, body: JSON.parse(String(init?.body)), url: String(input) });
    const answer = answers[target] ?? { status: 400, body: { __type: "InvalidParameterException" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return { fetch, calls };
}

const account = (fetch: typeof globalThis.fetch, token: string | null = "access-1") =>
  new CognitoAccount({ region: "eu-central-1", getAccessToken: async () => token, fetch });

describe("cognitoRegion", () => {
  it("reads the region from a prefix domain", () => {
    expect(cognitoRegion("https://tempo-dev-123.auth.eu-central-1.amazoncognito.com")).toBe("eu-central-1");
  });

  it("has none for a custom domain", () => {
    expect(cognitoRegion("https://auth.example.com")).toBeNull();
  });
});

describe("accessTokenScopes", () => {
  it("reads the scope claim", () => {
    expect(accessTokenScopes(jwt({ scope: "openid aws.cognito.signin.user.admin" }))).toEqual([
      "openid",
      "aws.cognito.signin.user.admin",
    ]);
  });

  it("is empty for a token it cannot read", () => {
    expect(accessTokenScopes("not-a-jwt")).toEqual([]);
  });
});

describe("otpauthUri", () => {
  it("names the issuer and the account, and carries the secret", () => {
    const uri = new URL(otpauthUri({ issuer: "Tempo", account: "dana@example.com", secret: "ABC234" }));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Tempo:dana@example.com");
    expect(Object.fromEntries(uri.searchParams)).toMatchObject({
      secret: "ABC234",
      issuer: "Tempo",
      digits: "6",
      period: "30",
    });
  });
});

describe("CognitoAccount", () => {
  it("calls the region's user API with the access token", async () => {
    const { fetch, calls } = stub({ GetUser: { body: { UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] } } });
    expect(await account(fetch).totpStatus()).toEqual({ enabled: true });
    expect(calls[0]).toEqual({
      target: "GetUser",
      body: { AccessToken: "access-1" },
      url: "https://cognito-idp.eu-central-1.amazonaws.com/",
    });
  });

  it("reports TOTP off when no MFA is set up", async () => {
    const { fetch } = stub({ GetUser: { body: {} } });
    expect(await account(fetch).totpStatus()).toEqual({ enabled: false });
  });

  it("verifies the code, then makes TOTP the preferred method", async () => {
    const { fetch, calls } = stub({
      AssociateSoftwareToken: { body: { SecretCode: "SECRET" } },
      VerifySoftwareToken: { body: { Status: "SUCCESS" } },
      SetUserMFASettings: { body: {} },
    });
    const cognito = account(fetch);
    expect(await cognito.startTotp()).toBe("SECRET");
    await cognito.confirmTotp("123456", "Tempo");
    expect(calls.map((call) => call.target)).toEqual([
      "AssociateSoftwareToken",
      "VerifySoftwareToken",
      "SetUserMFASettings",
    ]);
    expect(calls[1]!.body).toEqual({ AccessToken: "access-1", UserCode: "123456", FriendlyDeviceName: "Tempo" });
    expect(calls[2]!.body).toEqual({
      AccessToken: "access-1",
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    });
  });

  it("maps Cognito's exceptions to codes", async () => {
    const { fetch } = stub({
      VerifySoftwareToken: { status: 400, body: { __type: "com.amazonaws#CodeMismatchException" } },
      AssociateSoftwareToken: { status: 400, body: { __type: "NotAuthorizedException" } },
    });
    await expect(account(fetch).confirmTotp("000000", "Tempo")).rejects.toMatchObject({ code: "code_mismatch" });
    await expect(account(fetch).startTotp()).rejects.toMatchObject({ code: "not_authorized" });
  });

  it("does not call Cognito when signed out", async () => {
    const { fetch } = stub({});
    await expect(account(fetch, null).totpStatus()).rejects.toBeInstanceOf(CognitoAccountError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

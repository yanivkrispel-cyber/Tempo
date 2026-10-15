import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { accountAdminScope, defaultScopes } from "@tempo/api-client/auth";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, signedInRoutes } from "../../test/api";
import { memoryStorage, sessionStorageWith, signedInAuth, testAuthConfig } from "../../test/auth";

const jwt = (payload: Record<string, unknown>) =>
  `e30.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.sig`;

const setupConfig = { ...testAuthConfig, scopes: [...defaultScopes, accountAdminScope] };

/** An account whose sign-in asked for the account scope; `scope` is what its access token carries. */
function authWith(scope: string, redirect = vi.fn()) {
  const session = { accessToken: jwt({ scope }), refreshToken: "refresh-1", expiresAt: Date.now() + 3_600_000 };
  return signedInAuth({
    config: setupConfig,
    storage: sessionStorageWith(session),
    flowStorage: memoryStorage(),
    redirect,
  });
}

type Answer = { status?: number; body: unknown };

/** Cognito's user API, as the page calls it with the global fetch. Each target answers its queue, then its last. */
function stubCognito(answers: Record<string, Answer[]>) {
  const calls: { target: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    const target = String(new Headers(init?.headers).get("X-Amz-Target")).split(".").pop()!;
    calls.push({ target, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const queue = answers[target] ?? [{ status: 400, body: { __type: "InvalidParameterException" } }];
    const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls };
}

function renderAt(url: string, auth = authWith(`openid ${accountAdminScope}`)) {
  const api = apiStub(signedInRoutes);
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [url] })}
      auth={auth}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("two-step sign-in setup", () => {
  it("adds the account to an authenticator app and turns TOTP on", async () => {
    const cognito = stubCognito({
      GetUser: [{ body: {} }, { body: { UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] } }],
      AssociateSoftwareToken: [{ body: { SecretCode: "JBSWY3DPEHPK3PXPJBSWY3DP" } }],
      VerifySoftwareToken: [
        { status: 400, body: { __type: "CodeMismatchException" } },
        { body: { Status: "SUCCESS" } },
      ],
      SetUserMFASettings: [{ body: {} }],
    });
    const api = renderAt("/account/security");

    expect(await screen.findByRole("heading", { name: "אימות דו־שלבי כבוי" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "הפעלת אימות דו־שלבי" }));

    expect(await screen.findByRole("img", { name: "קוד QR להוספת החשבון לאפליקציית האימות" })).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP JBSW Y3DP")).toBeInTheDocument();

    const code = screen.getByRole("textbox", { name: /הקוד מהאפליקציה/ });
    await userEvent.click(screen.getByRole("button", { name: "הפעלה" }));
    expect(code).toHaveAccessibleDescription("6 ספרות מהאפליקציה");
    expect(cognito.calls.map((call) => call.target)).not.toContain("VerifySoftwareToken");

    await userEvent.type(code, "111111");
    await userEvent.click(screen.getByRole("button", { name: "הפעלה" }));
    await waitFor(() => expect(code).toHaveAccessibleDescription(/הקוד לא תואם/));

    await userEvent.clear(code);
    await userEvent.type(code, "123 456");
    await userEvent.click(screen.getByRole("button", { name: "הפעלה" }));

    expect(await screen.findByText("אימות דו־שלבי הופעל")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "אימות דו־שלבי פעיל" })).toBeInTheDocument();
    const verify = cognito.calls.filter((call) => call.target === "VerifySoftwareToken").at(-1)!;
    expect(verify.body).toMatchObject({ UserCode: "123456", FriendlyDeviceName: "Tempo" });
    expect(cognito.calls.at(-2)!.target).toBe("SetUserMFASettings");
    // The account is loaded again, so the API reads the new MFA setting (auth.mfa_required goes away).
    await waitFor(() =>
      expect(api.requests.filter((request) => request.url.endsWith("/api/v1/session")).length).toBe(2),
    );
  });

  it("offers to move an active setup to another app", async () => {
    stubCognito({ GetUser: [{ body: { UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] } }] });
    renderAt("/account/security");
    expect(await screen.findByRole("heading", { name: "אימות דו־שלבי פעיל" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "העברה לאפליקציה אחרת" })).toBeEnabled();
  });

  it("asks to sign in again when the token was issued without the account scope", async () => {
    const cognito = stubCognito({});
    const redirect = vi.fn();
    renderAt("/account/security", authWith("openid email profile", redirect));

    expect(await screen.findByText("כדי לשנות את הגדרות האבטחה צריך להתחבר מחדש.")).toBeInTheDocument();
    expect(cognito.fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "התחברות מחדש" }));
    const url = new URL(redirect.mock.calls[0]![0] as string);
    expect(url.searchParams.get("scope")).toContain(accountAdminScope);
  });

  it("says when Cognito cannot be reached, and tries again", async () => {
    const cognito = stubCognito({ GetUser: [{ status: 500, body: {} }, { status: 500, body: {} }, { body: {} }] });
    renderAt("/account/security");
    expect(await screen.findByRole("alert", undefined, { timeout: 3000 })).toHaveTextContent(
      "לא הצלחנו לבדוק את הגדרות האבטחה",
    );
    await userEvent.click(screen.getByRole("button", { name: "ניסיון נוסף" }));
    expect(await screen.findByRole("heading", { name: "אימות דו־שלבי כבוי" })).toBeInTheDocument();
    expect(cognito.calls.length).toBe(3);
  });

  it("is not offered while sign-in does not ask for the account scope", async () => {
    const cognito = stubCognito({});
    renderAt("/account/security", signedInAuth());
    expect(await screen.findByRole("heading", { name: "ההגדרה עוד לא זמינה כאן" })).toBeInTheDocument();
    expect(cognito.fetch).not.toHaveBeenCalled();
  });

  it("is linked from the studio list", async () => {
    stubCognito({});
    renderAt("/select-organization", signedInAuth());
    expect(await screen.findByRole("link", { name: "אבטחת החשבון" })).toHaveAttribute("href", "/account/security");
  });
});

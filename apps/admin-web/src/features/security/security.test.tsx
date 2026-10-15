import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { accountAdminScope } from "@tempo/api-client/auth";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, signedInRoutes } from "../../test/api";
import { memoryStorage, sessionStorageWith, signedInAuth, signedOutAuth, testAuthConfig } from "../../test/auth";

const jwt = (payload: Record<string, unknown>) =>
  `e30.${btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.sig`;

/** The app client offers the account scope (VITE_COGNITO_MFA_SETUP on); only the setup page's sign-in asks for it. */
const setupConfig = { ...testAuthConfig, optionalScopes: [accountAdminScope] };

const secret = "JBSWY3DPEHPK3PXPJBSWY3DP";
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A session whose token carries `scope`, signed in `ageMinutes` ago. */
function authWith(scope: string, { redirect = vi.fn(), ageMinutes = 1 } = {}) {
  const accessToken = jwt({ scope, auth_time: nowSeconds() - ageMinutes * 60 });
  const session = { accessToken, refreshToken: "refresh-1", expiresAt: Date.now() + 3_600_000 };
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [url] })}
      auth={auth}
      apiUrl="https://api.test"
      fetch={api.fetch}
      queryClient={queryClient}
    />,
  );
  return { api, queryClient };
}

/** Whether the TOTP secret is still held anywhere in the query client (it must live in component state only). */
const cacheHoldsSecret = (queryClient: QueryClient) =>
  queryClient
    .getMutationCache()
    .getAll()
    .some((mutation) => JSON.stringify(mutation.state.data ?? null).includes(secret));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("two-step sign-in setup", () => {
  it("adds the account to an authenticator app and turns TOTP on", async () => {
    const cognito = stubCognito({
      GetUser: [{ body: {} }, { body: { UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] } }],
      AssociateSoftwareToken: [{ body: { SecretCode: secret } }],
      VerifySoftwareToken: [
        { status: 400, body: { __type: "CodeMismatchException" } },
        { body: { Status: "SUCCESS" } },
      ],
      SetUserMFAPreference: [{ body: {} }],
    });
    const { api, queryClient } = renderAt("/account/security");

    expect(await screen.findByRole("heading", { name: "אימות דו־שלבי כבוי" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "הפעלת אימות דו־שלבי" }));

    expect(await screen.findByRole("img", { name: "קוד QR להוספת החשבון לאפליקציית האימות" })).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP JBSW Y3DP")).toBeInTheDocument();
    // On screen, but not left in the mutation cache.
    await waitFor(() => expect(cacheHoldsSecret(queryClient)).toBe(false));

    const code = screen.getByRole("textbox", { name: /הקוד מהאפליקציה/ });
    await userEvent.click(screen.getByRole("button", { name: "הפעלה" }));
    expect(code).toHaveAccessibleDescription("הקלידו את 6 הספרות שמוצגות באפליקציה.");
    expect(cognito.calls.map((call) => call.target)).not.toContain("VerifySoftwareToken");

    await userEvent.type(code, "111111");
    await userEvent.click(screen.getByRole("button", { name: "הפעלה" }));
    await waitFor(() => expect(code).toHaveAccessibleDescription(/הקוד לא תואם/));

    await userEvent.clear(code);
    await userEvent.type(code, "123 456");
    await userEvent.click(screen.getByRole("button", { name: "הפעלה" }));

    expect(await screen.findByText("אימות דו־שלבי הופעל")).toBeInTheDocument();
    const heading = await screen.findByRole("heading", { name: "אימות דו־שלבי פעיל" });
    expect(heading).toHaveFocus();
    expect(cacheHoldsSecret(queryClient)).toBe(false);
    const verify = cognito.calls.filter((call) => call.target === "VerifySoftwareToken").at(-1)!;
    expect(verify.body).toMatchObject({ UserCode: "123456", FriendlyDeviceName: "Tempo" });
    expect(cognito.calls.at(-2)!.target).toBe("SetUserMFAPreference");
    // The account is loaded again, so the API reads the new MFA setting (auth.mfa_required goes away).
    await waitFor(() =>
      expect(api.requests.filter((request) => request.url.endsWith("/api/v1/session")).length).toBe(2),
    );
  });

  it("returns focus to the status heading and forgets the secret on cancel", async () => {
    stubCognito({ GetUser: [{ body: {} }], AssociateSoftwareToken: [{ body: { SecretCode: secret } }] });
    const { queryClient } = renderAt("/account/security");
    await userEvent.click(await screen.findByRole("button", { name: "הפעלת אימות דו־שלבי" }));
    await userEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    expect(screen.getByRole("heading", { name: "אימות דו־שלבי כבוי" })).toHaveFocus();
    expect(screen.queryByText(/JBSW/)).not.toBeInTheDocument();
    expect(cacheHoldsSecret(queryClient)).toBe(false);
  });

  it("moves an active setup to another app after a recent sign-in", async () => {
    const cognito = stubCognito({
      GetUser: [{ body: { UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] } }],
      AssociateSoftwareToken: [{ body: { SecretCode: secret } }],
    });
    renderAt("/account/security", authWith(`openid ${accountAdminScope}`, { ageMinutes: 5 }));
    await userEvent.click(await screen.findByRole("button", { name: "העברה לאפליקציה אחרת" }));
    expect(await screen.findByRole("img", { name: /קוד QR/ })).toBeInTheDocument();
    expect(cognito.calls.map((call) => call.target)).toContain("AssociateSoftwareToken");
  });

  it("asks for the password again before moving an active setup when the sign-in is over 10 minutes old", async () => {
    const cognito = stubCognito({ GetUser: [{ body: { UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] } }] });
    const redirect = vi.fn();
    renderAt("/account/security", authWith(`openid ${accountAdminScope}`, { redirect, ageMinutes: 11 }));
    await userEvent.click(await screen.findByRole("button", { name: "העברה לאפליקציה אחרת" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    const url = new URL(redirect.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/logout");
    expect(url.searchParams.get("scope")).toContain(accountAdminScope);
    expect(cognito.calls.map((call) => call.target)).not.toContain("AssociateSoftwareToken");
  });

  it("starts the sign-in that asks for the account scope when the token lacks it", async () => {
    const cognito = stubCognito({});
    const redirect = vi.fn();
    renderAt("/account/security", authWith("openid email profile", { redirect }));

    expect(await screen.findByText("כדי לשנות את הגדרות האבטחה צריך להתחבר מחדש.")).toBeInTheDocument();
    expect(cognito.fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "התחברות מחדש" }));
    const url = new URL(redirect.mock.calls[0]![0] as string);
    expect(url.searchParams.get("scope")).toBe(`openid email profile ${accountAdminScope}`);
  });

  it("never asks for the account scope on a normal sign-in", async () => {
    stubCognito({});
    const redirect = vi.fn();
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: ["/login"] })}
        auth={signedOutAuth({ config: setupConfig, redirect })}
        apiUrl="https://api.test"
        fetch={apiStub({}).fetch}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "התחברות" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    expect(new URL(redirect.mock.calls[0]![0] as string).searchParams.get("scope")).toBe("openid email profile");
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

  it("is not offered while the app client does not offer the account scope", async () => {
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

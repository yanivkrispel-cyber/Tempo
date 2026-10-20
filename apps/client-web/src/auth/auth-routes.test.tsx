import type { AuthClient } from "@tempo/api-client/auth";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProvider, useApi } from "../api/ApiProvider";
import { App } from "../app/App";
import { routes } from "../app/routes";
import { studioSlugOf } from "../app/studioPath";
import { apiStub, problem, signedInRoutes } from "../test/api";
import { memoryStorage, signedInAuth, signedOutAuth } from "../test/auth";

function renderAt(
  url: string,
  auth: AuthClient | null,
  fetch: typeof globalThis.fetch = apiStub(signedInRoutes).fetch,
) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={auth} apiUrl="https://api.test" fetch={fetch} />);
  return router;
}

describe("protected routes", () => {
  it("sends a signed-out visitor to /login and remembers the page", async () => {
    const router = renderAt("/bookings", signedOutAuth());
    expect(await screen.findByRole("heading", { name: "ברוכים הבאים ל־Tempo" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("?returnTo=%2Fbookings");
  });

  it("starts the Hosted UI sign-in from /login with the remembered page", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    renderAt("/login?returnTo=%2Fbookings", signedOutAuth({ redirect, flowStorage }));
    await userEvent.click(screen.getByRole("button", { name: "התחברות" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({ returnTo: "/bookings" });
  });

  it("does not follow a returnTo that leaves the app", async () => {
    const router = renderAt("/login?returnTo=%2F%2Fevil.example", signedInAuth());
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it.each(["https://evil.example", "/\\evil.example", "/\t/evil.example", "javascript:alert(1)", "/auth/callback"])(
    "lands on the safe default for the hostile returnTo %j",
    async (returnTo) => {
      const router = renderAt(`/login?returnTo=${encodeURIComponent(returnTo)}`, signedInAuth());
      await waitFor(() => expect(router.state.location.pathname).toBe("/"));
      expect(router.state.location.search).toBe("");
    },
  );

  it.each(["/s/other-studio/", "/s/other-studio/../../admin"])(
    "keeps a returnTo of %s inside the studio's own app on that studio's sign-in",
    async (returnTo) => {
      const flowStorage = memoryStorage();
      const redirect = vi.fn();
      await signedOutAuth({ flowStorage, redirect, basePath: "/s/neshima" }).signIn(returnTo);
      const stored = JSON.parse(flowStorage.getItem("tempo.client-web.signin")!) as { returnTo: string };
      const resolved = new URL(stored.returnTo, "https://app.example");
      expect(resolved.origin).toBe("https://app.example");
      expect(studioSlugOf(resolved.pathname)).toBe("neshima");
    },
  );

  it("explains a missing sign-in configuration instead of offering a dead button", async () => {
    renderAt("/", null);
    expect(await screen.findByRole("status")).toHaveTextContent("ההתחברות לא מוגדרת");
    expect(screen.queryByRole("button", { name: "התחברות" })).not.toBeInTheDocument();
  });

  it("keeps /invite and /join public", async () => {
    renderAt("/invite#tok_QW5faW52aXRhdGlvbi10b2tlbi1mb3ItdGVzdHM", signedOutAuth());
    expect(await screen.findByRole("heading", { name: "הוזמנת לסטודיו" })).toBeInTheDocument();
  });
});

describe("/auth/callback", () => {
  it("completes the sign-in and opens the remembered page", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 }),
      );
    const auth = signedOutAuth({ redirect, flowStorage, fetch });
    await auth.signIn("/bookings");
    const state = new URL(redirect.mock.calls[0]![0] as string).searchParams.get("state")!;

    const router = renderAt(`/auth/callback?code=c0de&state=${state}`, auth);
    await waitFor(() => expect(router.state.location.pathname).toBe("/bookings"));
    expect(auth.isSignedIn).toBe(true);
  });

  it("shows an error for a forged state", async () => {
    renderAt("/auth/callback?code=c0de&state=forged", signedOutAuth());
    expect(await screen.findByRole("alert")).toHaveTextContent("ההתחברות נכשלה");
    expect(screen.getByRole("link", { name: "חזרה להתחברות" })).toHaveAttribute("href", "/login");
  });
});

describe("API client", () => {
  async function callMe(answer: Response) {
    const auth = signedInAuth();
    const api = vi.fn<typeof globalThis.fetch>().mockResolvedValue(answer);
    let call: Promise<unknown> | undefined;
    function Probe() {
      const client = useApi();
      call ??= client.GET("/api/v1/me");
      return null;
    }
    render(
      <ApiProvider baseUrl="https://api.test" auth={auth} fetch={api}>
        <Probe />
      </ApiProvider>,
    );
    await call;
    return { auth, request: api.mock.calls[0]![0] as Request };
  }

  it("signs out locally when the API rejects the token", async () => {
    const { auth, request } = await callMe(new Response(null, { status: 401 }));
    expect(request.url).toBe("https://api.test/api/v1/me");
    expect(request.headers.get("Authorization")).toBe("Bearer access-1");
    expect(auth.isSignedIn).toBe(false);
  });

  it("keeps the session when the API asks for a fresh sign-in for one action (step-up)", async () => {
    const { auth } = await callMe(problem(401, "auth.step_up_required"));
    expect(auth.isSignedIn).toBe(true);
  });
});

describe("branded_login (docs/36)", () => {
  const password = "Correct-Horse-9";
  const secrets = [password, "cognito-session-1", "access-from-cognito", "refresh-from-cognito"];

  /** Cognito's JSON API, by `X-Amz-Target`, as the sign-in screen calls it. */
  function cognitoStub() {
    const calls: string[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(new Headers(init?.headers).get("X-Amz-Target")).split(".").pop()!;
      calls.push(target);
      const body =
        target === "InitiateAuth"
          ? { ChallengeName: "SELECT_CHALLENGE", Session: "cognito-session-1", AvailableChallenges: ["PASSWORD"] }
          : {
              AuthenticationResult: {
                AccessToken: "access-from-cognito",
                RefreshToken: "refresh-from-cognito",
                ExpiresIn: 3600,
              },
            };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/x-amz-json-1.1" } });
    });
    vi.stubGlobal("fetch", fetch);
    return calls;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the Hosted UI page while the flag is off", async () => {
    renderAt("/login", signedOutAuth());
    expect(await screen.findByRole("heading", { name: "ברוכים הבאים ל־Tempo" })).toBeInTheDocument();
  });

  it("signs in on our own screen, stores the session and opens the remembered page, without logging a secret", async () => {
    vi.stubEnv("VITE_BRANDED_LOGIN", "true");
    const consoleCalls = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const calls = cognitoStub();
    const storage = memoryStorage();
    const router = renderAt("/login?returnTo=%2Fbookings", signedOutAuth({ storage }));

    await userEvent.type(await screen.findByLabelText("אימייל"), "noga@example.com");
    await userEvent.click(screen.getByRole("button", { name: "המשך" }));
    await userEvent.type(await screen.findByLabelText("סיסמה"), password);
    await userEvent.click(screen.getByRole("button", { name: "כניסה" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/bookings"));
    expect(calls).toEqual(["InitiateAuth", "RespondToAuthChallenge"]);
    expect(JSON.parse(storage.getItem("tempo.client-web.session")!)).toMatchObject({
      accessToken: "access-from-cognito",
      refreshToken: "refresh-from-cognito",
    });
    const logged = consoleCalls.flatMap((spy) => spy.mock.calls).map((args) => args.map(String).join(" "));
    for (const secret of secrets) expect(logged.filter((line) => line.includes(secret))).toEqual([]);
  });

  it("keeps the usual sign-in one tap away", async () => {
    vi.stubEnv("VITE_BRANDED_LOGIN", "true");
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    renderAt("/login?returnTo=%2Fbookings", signedOutAuth({ redirect, flowStorage }));
    await userEvent.click(await screen.findByRole("button", { name: "כניסה בדרך הרגילה" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({ returnTo: "/bookings" });
  });

  it("opens the sign-up step from a sign-up button elsewhere in the app", async () => {
    vi.stubEnv("VITE_BRANDED_LOGIN", "true");
    const router = renderAt("/invite#tok_QW5faW52aXRhdGlvbi10b2tlbi1mb3ItdGVzdHM", signedOutAuth());
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה" }));
    expect(await screen.findByRole("button", { name: "יצירת חשבון" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(new URLSearchParams(router.state.location.search).get("returnTo")).toBe("/invite");
  });
});

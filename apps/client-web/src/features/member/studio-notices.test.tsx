import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, problem, sampleMe, signedInRoutes } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const profilePath = `GET /api/v1/organizations/${studio.organization.id}/me/profile`;

function renderAt(url: string, routesForApi: Record<string, unknown> = {}) {
  const api = apiStub({ ...signedInRoutes, ...routesForApi });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [url] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
      today="2026-10-13"
    />,
  );
  return api;
}

const withState = (subscriptionState: string | undefined) => ({
  "POST /api/v1/session": { ...sampleMe, memberships: [{ ...studio, subscriptionState }] },
});

describe("studio states", () => {
  it("pauses booking while the studio's subscription is restricted, and says so", async () => {
    renderAt("/book", withState("restricted"));
    expect(await screen.findByRole("heading", { level: 1, name: "מערכת שיעורים" })).toBeInTheDocument();
    expect(screen.getByText(/ההרשמה לשיעורים בסטודיו מושהית כרגע/)).toBeInTheDocument();
    const bookButtons = screen.getAllByRole("button", { name: /^הרשמה ל/ });
    expect(bookButtons.length).toBeGreaterThan(0);
    for (const button of bookButtons) expect(button).toBeDisabled();
  });

  it.each([undefined, "active"])("books as usual when the subscription state is %s", async (state) => {
    renderAt("/book", withState(state));
    await screen.findByRole("heading", { level: 1, name: "מערכת שיעורים" });
    expect(screen.queryByText(/מושהית/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^הרשמה ל/ })[0]).toBeEnabled();
  });

  it("tells an owner or admin without MFA where to turn it on", async () => {
    renderAt("/profile", { [profilePath]: problem(403, "auth.mfa_required") });
    // The frame says it once under the heading (the consent section shows its own error too).
    await waitFor(
      () => {
        const notices = screen.getAllByRole("status").filter((node) => node.classList.contains("tp-banner--warning"));
        expect(notices.map((node) => node.textContent)).toEqual([
          expect.stringMatching(/במסוף הניהול, בעמוד אבטחת החשבון/),
        ]);
      },
      { timeout: 3000 },
    );
  });
});

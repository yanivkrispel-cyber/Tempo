import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { createApi } from "../api/ApiProvider";
import { apiStub } from "../test/api";
import { signedInAuth } from "../test/auth";
import { createStudio, organizationId, testNow, testToday } from "../test/studio";
import { App, createQueryClient } from "./App";
import { startFirstReads } from "./firstReads";
import { routes } from "./routes";

/** Starts the reads as `main.tsx` does, with nothing rendered yet. */
function start(pathname: string, search = "") {
  const studio = createStudio();
  const stub = apiStub(studio.routes);
  const auth = signedInAuth();
  const queryClient = createQueryClient();
  const api = createApi({ baseUrl: "https://api.test", auth, fetch: stub.fetch });
  startFirstReads({ queryClient, api, pathname, search, studioSlug: null, now: testNow });
  const renderApp = () =>
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: [pathname + search] })}
        auth={auth}
        now={testNow}
        queryClient={queryClient}
        api={api}
      />,
    );
  const calls = () => stub.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`);
  return { stub, renderApp, calls };
}

const studioPath = `/api/v1/organizations/${organizationId}`;

describe("first reads (board #537, O1)", () => {
  it("starts the session and then the timetable's reads before anything renders", async () => {
    const { stub, calls } = start("/book");
    await waitFor(() =>
      expect(calls()).toEqual([
        "POST /api/v1/session",
        `GET ${studioPath}/sessions`,
        `GET ${studioPath}/booking-policy`,
        `GET ${studioPath}/me/passes`,
      ]),
    );
    const sessions = new URL(stub.requests[1]!.url).searchParams;
    expect([sessions.get("from"), sessions.get("to")]).toEqual([testToday, "2026-10-19"]);
  });

  it("the timetable then reads nothing a second time", async () => {
    const { renderApp, calls } = start("/book");
    await waitFor(() => expect(calls()).toHaveLength(4));
    renderApp();
    expect(await screen.findByRole("heading", { level: 1, name: "מערכת שיעורים" })).toBeInTheDocument();
    await screen.findAllByRole("link", { name: /פילאטיס מכשירים/ });
    for (const call of ["POST /api/v1/session", `GET ${studioPath}/sessions`, `GET ${studioPath}/me/passes`])
      expect(calls().filter((made) => made === call)).toHaveLength(1);
  });

  it("starts the bookings screen's reads", async () => {
    const { calls } = start("/bookings");
    await waitFor(() =>
      expect(calls()).toEqual([
        "POST /api/v1/session",
        `GET ${studioPath}/me/bookings`,
        `GET ${studioPath}/me/notifications`,
      ]),
    );
  });

  it("starts the home's one read", async () => {
    const { calls } = start("/");
    await waitFor(() => expect(calls()).toEqual(["POST /api/v1/session", `GET ${studioPath}/me/home`]));
  });

  it("leaves another week, and screens it doesn't know, to the screen", async () => {
    const week = start("/book", "?day=2026-10-21");
    await waitFor(() => expect(week.calls()).toHaveLength(3));
    expect(week.calls()).not.toContain(`GET ${studioPath}/sessions`);

    const profile = start("/profile");
    await waitFor(() => expect(profile.calls()).toEqual(["POST /api/v1/session"]));
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe, signedInRoutes } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const preferencesRoute = `/api/v1/organizations/${sampleMe.memberships[0]!.organization.id}/me/notification-preferences`;

const defaults = {
  groups: [
    { group: "bookings", channels: { inbox: true, push: true } },
    { group: "reminders", channels: { inbox: true, push: true } },
    { group: "studio", channels: { inbox: true, push: true } },
  ],
  reminders: { classTomorrow: true, classSoon: true, passEnding: true, entriesLow: true },
  quietHours: null,
  studioQuietHours: { startsLocal: "22:00", endsLocal: "08:00" },
  // The studio does not send the entries-low reminder, so the page does not offer it.
  studioReminders: { classTomorrow: true, classSoon: true, passEnding: true, entriesLow: false },
  timeZone: "Asia/Jerusalem",
  version: "3",
};

function renderAt(path: string, routesForApi: Record<string, unknown> = {}) {
  const api = apiStub({ ...signedInRoutes, [`GET ${preferencesRoute}`]: defaults, ...routesForApi });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [path] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
      today="2026-10-16"
    />,
  );
  return api;
}

describe("notification preferences", () => {
  it("opens from the profile", async () => {
    renderAt("/profile");
    await userEvent.click(await screen.findByRole("link", { name: /העדפות התראות/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "העדפות התראות" })).toBeInTheDocument();
  });

  it("shows push per group, only the reminders the studio offers, and the studio's quiet hours", async () => {
    renderAt("/profile/notifications");
    expect(await screen.findByRole("switch", { name: "ההרשמות שלי: התראה בטלפון" })).toBeChecked();
    // The row's hint is the switch's description, so a screen reader hears it once, with the switch.
    expect(screen.getByRole("switch", { name: "ההרשמות שלי: התראה בטלפון" })).toHaveAccessibleDescription(
      "נרשמת, עברת מרשימת ההמתנה, שיעור בוטל או השתנה",
    );
    expect(screen.getByRole("switch", { name: "הודעות מהסטודיו: התראה בטלפון" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "ערב לפני שיעור" })).toBeChecked();
    expect(screen.queryByRole("switch", { name: "כשנשארות מעט כניסות בכרטיסייה" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /כמו בסטודיו/ })).toBeChecked();
    expect(screen.getByText("22:00–08:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled();
  });

  it("saves the changes with the version it read", async () => {
    const api = renderAt("/profile/notifications", {
      [`PUT ${preferencesRoute}`]: (request: Request) =>
        request
          .clone()
          .json()
          .then((body) => json({ ...defaults, ...body, version: "4" })),
    });
    await userEvent.click(await screen.findByRole("switch", { name: "הודעות מהסטודיו: התראה בטלפון" }));
    await userEvent.click(screen.getByRole("switch", { name: "זמן קצר לפני שיעור" }));
    await userEvent.click(screen.getByRole("radio", { name: "שעות משלי" }));
    await userEvent.click(screen.getByRole("button", { name: "שמירה" }));

    expect(await screen.findByText("ההעדפות נשמרו")).toBeInTheDocument();
    const put = api.requests.findIndex((request) => request.method === "PUT");
    expect(api.requests[put]!.headers.get("If-Match")).toBe("3");
    expect(api.bodies[put]).toEqual({
      groups: [
        { group: "bookings", channels: { inbox: true, push: true } },
        { group: "reminders", channels: { inbox: true, push: true } },
        { group: "studio", channels: { inbox: true, push: false } },
      ],
      reminders: { classTomorrow: true, classSoon: false, passEnding: true, entriesLow: true },
      quietHours: { startsLocal: "22:00", endsLocal: "08:00" },
    });
  });

  it("refuses an own window that starts and ends at the same time", async () => {
    renderAt("/profile/notifications");
    await userEvent.click(await screen.findByRole("radio", { name: "שעות משלי" }));
    const until = screen.getByRole("combobox", { name: "עד" });
    await userEvent.clear(until);
    await userEvent.type(until, "22:00{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled());
    expect(screen.getByText("שעת הסיום צריכה להיות שונה משעת ההתחלה.")).toBeInTheDocument();
  });

  it("explains a stale version", async () => {
    renderAt("/profile/notifications", { [`PUT ${preferencesRoute}`]: problem(409, "concurrency.conflict") });
    await userEvent.click(await screen.findByRole("switch", { name: "ערב לפני שיעור" }));
    await userEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(/ההעדפות השתנו במכשיר אחר/)).toBeInTheDocument();
  });

  it("says so when the preferences cannot be read", async () => {
    renderAt("/profile/notifications", { [`GET ${preferencesRoute}`]: problem(500, "http.500") });
    // One retry before the error shows.
    expect(
      await screen.findByText("לא הצלחנו לטעון את ההעדפות. נסו שוב מאוחר יותר.", undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
  });
});

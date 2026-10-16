import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;

const settings = {
  quietHours: { startsLocal: "22:00", endsLocal: "08:00" },
  reminders: {
    classTomorrow: { enabled: true, sendAtLocal: "18:00" },
    classSoon: { enabled: true, hoursBefore: 2 },
    passEnding: { enabled: true, daysBefore: 7 },
    entriesLow: { enabled: true, entriesLeft: 1 },
  },
  timeZone: "Asia/Jerusalem",
  version: "5",
};

function renderAt(routesForApi: Record<string, unknown>, role: "owner" | "staff" = "owner") {
  const me = { ...sampleMe, memberships: [membershipAs(role)] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}/notification-settings`]: settings,
    ...routesForApi,
  });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: ["/o/neshima/settings"] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

describe("studio notification settings", () => {
  it("saves quiet hours and reminder timing with If-Match", async () => {
    const api = renderAt({
      [`PUT ${base}/notification-settings`]: (request: Request) =>
        request
          .clone()
          .json()
          .then((body) => json({ ...settings, ...body, version: "6" })),
    });
    const card = await screen.findByRole("region", { name: "התראות ותזכורות" });
    const save = within(card).getByRole("button", { name: "שמירת הגדרות ההתראות" });
    expect(save).toBeDisabled();

    const sendAt = within(card).getByRole("combobox", { name: "שעת השליחה" });
    expect(
      within(sendAt)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"]);
    await userEvent.selectOptions(sendAt, "19:00");
    await userEvent.selectOptions(within(card).getByRole("combobox", { name: "כמה זמן לפני" }), "3");
    await userEvent.click(within(card).getByRole("switch", { name: "כשנשארות מעט כניסות בכרטיסייה" }));
    expect(within(card).getByRole("combobox", { name: "כשנשארות" })).toBeDisabled();
    await userEvent.click(save);

    expect(await screen.findByText("הגדרות ההתראות נשמרו")).toBeInTheDocument();
    const put = api.requests.findIndex((request) => request.method === "PUT");
    expect(api.requests[put]!.headers.get("If-Match")).toBe("5");
    expect(api.bodies[put]).toEqual({
      quietHours: { startsLocal: "22:00", endsLocal: "08:00" },
      reminders: {
        classTomorrow: { enabled: true, sendAtLocal: "19:00" },
        classSoon: { enabled: true, hoursBefore: 3 },
        passEnding: { enabled: true, daysBefore: 7 },
        entriesLow: { enabled: false, entriesLeft: 1 },
      },
    });
  });

  it("refuses quiet hours that start and end at the same time", async () => {
    renderAt({});
    const card = await screen.findByRole("region", { name: "התראות ותזכורות" });
    const until = within(card).getByRole("combobox", { name: "עד" });
    await userEvent.clear(until);
    await userEvent.type(until, "22:00{Enter}");
    expect(await within(card).findByText("שעת הסיום צריכה להיות שונה משעת ההתחלה.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "שמירת הגדרות ההתראות" })).toBeDisabled();
  });

  it("explains a conflict with someone else's change", async () => {
    renderAt({ [`PUT ${base}/notification-settings`]: problem(409, "concurrency.conflict") });
    const card = await screen.findByRole("region", { name: "התראות ותזכורות" });
    await userEvent.click(within(card).getByRole("switch", { name: "ערב לפני שיעור" }));
    await userEvent.click(within(card).getByRole("button", { name: "שמירת הגדרות ההתראות" }));
    expect(await within(card).findByText("מישהו אחר שינה את הנתונים בינתיים. רעננו ונסו שוב.")).toBeInTheDocument();
  });

  it("is read-only for staff", async () => {
    renderAt({}, "staff");
    const card = await screen.findByRole("region", { name: "התראות ותזכורות" });
    expect(within(card).getByRole("switch", { name: "ערב לפני שיעור" })).toBeDisabled();
    expect(within(card).getByRole("combobox", { name: "מ־" })).toBeDisabled();
    expect(within(card).queryByRole("button", { name: "שמירת הגדרות ההתראות" })).not.toBeInTheDocument();
  });
});

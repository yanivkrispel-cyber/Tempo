import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}/people`;
const childId = "0199e5a1-0000-7000-8000-000000000d01";
const parentId = "0199e5a1-0000-7000-8000-000000000d02";

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  givenName: null,
  familyName: null,
  birthDate: null,
  status: "active",
  source: "staff_created",
  hasLogin: false,
  membershipId: null,
  primaryEmail: null,
  primaryPhone: null,
  mergedIntoId: null,
  createdAt: "2026-10-15T08:00:00Z",
  version: "1",
});
const consent = (purpose: string, channel: string, state: string, occurredAt: string, method = "self") => ({
  id: `0199e5a1-0000-7000-8000-0000000e${purpose.length}${channel.length}${state.length}0`,
  purpose,
  channel,
  state,
  method,
  textVersion: "draft-2026-10-15",
  occurredAt,
});
const child = (relationships: unknown[] = []) => ({
  ...person(childId, "יואב"),
  contactPoints: [],
  consents: [consent("reminders", "email", "granted", "2026-10-14T08:00:00Z")],
  relationships,
});

function renderAt(routesForApi: Record<string, unknown>, role: "owner" | "staff" = "owner") {
  const me = { ...sampleMe, memberships: [{ ...studio, role, roles: [], permissions: [] }] };
  const api = apiStub({ "POST /api/v1/session": me, ...routesForApi });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [`/o/neshima/people/${childId}`] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

describe("consent on the person card", () => {
  it("shows the latest choice per purpose and channel, and the history", async () => {
    renderAt({
      [`GET ${base}/${childId}`]: child(),
      [`GET ${base}/${childId}/consents`]: {
        items: [
          consent("reminders", "email", "granted", "2026-10-14T08:00:00Z"),
          consent("reminders", "email", "withdrawn", "2026-10-01T08:00:00Z", "staff_on_behalf"),
        ],
      },
    });
    const section = await screen.findByRole("region", { name: "הסכמות" });
    const reminders = within(section).getByRole("row", { name: /תזכורות/ });
    expect(
      within(reminders)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["מאושר", "לא נבחר", "לא נבחר"]);

    await userEvent.click(within(section).getByRole("button", { name: "היסטוריה" }));
    const list = await screen.findByRole("list", { name: "הבחירות, מהחדשה לישנה" });
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("נרשם על ידי הסטודיו");
  });

  it("records a choice on someone's behalf with the text version", async () => {
    const api = renderAt({
      [`GET ${base}/${childId}`]: child(),
      [`POST ${base}/${childId}/consents`]: () =>
        json(consent("marketing", "whatsapp", "granted", "2026-10-15T09:00:00Z", "staff_on_behalf"), 201),
    });
    await userEvent.click(
      within(await screen.findByRole("region", { name: "הסכמות" })).getByRole("button", { name: "רישום בחירה" }),
    );
    const dialog = screen.getByRole("dialog", { name: "רישום בחירה" });
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "מטרה" }), "marketing");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "ערוץ" }), "whatsapp");
    await userEvent.click(within(dialog).getByRole("button", { name: "רישום" }));
    expect(await screen.findByText("הבחירה נרשמה")).toBeInTheDocument();
    const post = api.requests.findIndex((request) => request.method === "POST" && request.url.endsWith("/consents"));
    expect(api.bodies[post]).toEqual({
      purpose: "marketing",
      channel: "whatsapp",
      state: "granted",
      textVersion: "draft-2026-10-15",
    });
  });

  it("does not let staff record consent for someone else", async () => {
    renderAt({ [`GET ${base}/${childId}`]: child() }, "staff");
    const section = await screen.findByRole("region", { name: "הסכמות" });
    expect(within(section).queryByRole("button", { name: "רישום בחירה" })).not.toBeInTheDocument();
  });
});

describe("relationships on the person card", () => {
  it("lists a guardian and adds one with the guardian on the API's from side", async () => {
    let added = false;
    const api = renderAt({
      [`GET ${base}/${childId}`]: () =>
        json(
          child(
            added
              ? [
                  {
                    id: "0199e5a1-0000-7000-8000-000000000f01",
                    type: "guardian_of",
                    fromPersonId: parentId,
                    toPersonId: childId,
                    otherDisplayName: "מיכל",
                    createdAt: "2026-10-15T09:00:00Z",
                  },
                ]
              : [],
          ),
        ),
      [`GET ${base}`]: { items: [person(parentId, "מיכל"), person(childId, "יואב")], nextBefore: null },
      [`POST ${base}/${parentId}/relationships`]: () => {
        added = true;
        return json(
          {
            id: "0199e5a1-0000-7000-8000-000000000f01",
            type: "guardian_of",
            fromPersonId: parentId,
            toPersonId: childId,
            otherDisplayName: "יואב",
            createdAt: "2026-10-15T09:00:00Z",
          },
          201,
        );
      },
    });
    const section = await screen.findByRole("region", { name: "קשרים" });
    expect(section).toHaveTextContent("אין הורים, אפוטרופסים או אנשי קשר לחירום.");

    await userEvent.click(within(section).getByRole("button", { name: "הוספת קשר" }));
    const dialog = screen.getByRole("dialog", { name: "הוספת קשר" });
    await userEvent.type(within(dialog).getByRole("searchbox", { name: /חיפוש אדם/ }), "מיכ");
    const results = await within(dialog).findByRole("listbox", { name: "תוצאות" });
    expect(
      within(results)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["מיכל"]);
    await userEvent.click(within(results).getByRole("option", { name: "מיכל" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "הוספה" }));

    expect(await within(section).findByText("מיכל")).toBeInTheDocument();
    expect(section).toHaveTextContent("ההורה או האפוטרופוס: מיכל");
    const post = api.requests.findIndex(
      (request) => request.method === "POST" && request.url.endsWith("/relationships"),
    );
    expect(api.requests[post]!.url).toContain(`/people/${parentId}/relationships`);
    expect(api.bodies[post]).toEqual({ type: "guardian_of", toPersonId: childId });
  });

  it("removes a relationship", async () => {
    let removed = false;
    const relationship = {
      id: "0199e5a1-0000-7000-8000-000000000f02",
      type: "emergency_contact_for",
      fromPersonId: parentId,
      toPersonId: childId,
      otherDisplayName: "מיכל",
      createdAt: "2026-10-15T09:00:00Z",
    };
    const api = renderAt({
      [`GET ${base}/${childId}`]: () => json(child(removed ? [] : [relationship])),
      [`DELETE ${base}/${childId}/relationships/${relationship.id}`]: () => {
        removed = true;
        return new Response(null, { status: 204 });
      },
    });
    const section = await screen.findByRole("region", { name: "קשרים" });
    expect(section).toHaveTextContent("איש הקשר לחירום: מיכל");
    await userEvent.click(within(section).getByRole("button", { name: "הסרת הקשר עם מיכל" }));
    await waitFor(() => expect(section).toHaveTextContent("אין הורים, אפוטרופסים או אנשי קשר לחירום."));
    expect(api.requests.some((request) => request.method === "DELETE")).toBe(true);
  });
});

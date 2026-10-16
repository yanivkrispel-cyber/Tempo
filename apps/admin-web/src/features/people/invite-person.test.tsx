import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}/people`;
const personId = "0199e5a1-0000-7000-8000-000000000a01";
const phone = {
  id: "0199e5a1-0000-7000-8000-000000000a02",
  type: "phone",
  value: "+972502345678",
  isPrimary: true,
  verified: false,
  version: "1",
};
const email = {
  id: "0199e5a1-0000-7000-8000-000000000a03",
  type: "email",
  value: "yael@example.com",
  isPrimary: true,
  verified: false,
  version: "1",
};

const walkIn = (overrides: Record<string, unknown> = {}) => ({
  id: personId,
  displayName: "יעל",
  givenName: null,
  familyName: null,
  birthDate: null,
  status: "active",
  source: "staff_created",
  hasLogin: false,
  membershipId: null,
  primaryEmail: null,
  primaryPhone: phone.value,
  mergedIntoId: null,
  createdAt: "2026-10-15T08:00:00Z",
  version: "1",
  contactPoints: [phone],
  consents: [],
  relationships: [],
  ...overrides,
});

const created = {
  id: "0199e5a1-0000-7000-8000-000000000a04",
  email: "yael@example.com",
  role: "client",
  status: "pending",
  expiresAt: "2026-10-22T10:00:00Z",
  createdAt: "2026-10-15T10:00:00Z",
  invitedBy: { membershipId: studio.membershipId, displayName: "דנה כהן" },
  link: "http://localhost:5174/invite#abc",
};

function renderAt(routesForApi: Record<string, unknown>, permissions?: string[]) {
  const me = permissions
    ? { ...sampleMe, memberships: [{ ...studio, role: "staff", roles: [], permissions }] }
    : sampleMe;
  const api = apiStub({ "POST /api/v1/session": me, ...routesForApi });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [`/o/neshima/people/${personId}`] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

describe("inviting a recorded person to the app", () => {
  it("invites a walk-in with a new email and shows the link once", async () => {
    let invited = false;
    const api = renderAt({
      [`GET ${base}/${personId}`]: () =>
        json(invited ? walkIn({ primaryEmail: email.value, contactPoints: [phone, email] }) : walkIn()),
      [`POST ${base}/${personId}/invite`]: () => {
        invited = true;
        return json(created, 201);
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "הזמנה לאפליקציה" }));
    const dialog = screen.getByRole("dialog", { name: "הזמנה לאפליקציה" });
    const field = within(dialog).getByRole("textbox", { name: /מייל/ });
    expect(field).toHaveValue("");

    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת הזמנה" }));
    expect(within(dialog).getByText("כתובת מייל לא תקינה")).toBeInTheDocument();
    expect(api.requests.some((request) => request.url.endsWith("/invite"))).toBe(false);

    await userEvent.type(field, " yael@example.com ");
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת הזמנה" }));
    const done = await screen.findByRole("dialog", { name: "ההזמנה מוכנה" });
    expect(done).toHaveTextContent("שלחו את הקישור ל־yael@example.com. הוא בתוקף עד 22.10.2026.");
    expect(within(done).getByRole("textbox", { name: "קישור ההזמנה" })).toHaveValue(created.link);
    const post = api.requests.findIndex((request) => request.method === "POST" && request.url.endsWith("/invite"));
    expect(api.requests[post]!.url).toContain(`/people/${personId}/invite`);
    expect(api.bodies[post]).toEqual({ email: "yael@example.com" });

    // The new email is one of the person's contacts now.
    await userEvent.click(within(done).getByRole("button", { name: "סיום" }));
    expect(
      await within(screen.getByRole("region", { name: "פרטי קשר" })).findByText("yael@example.com"),
    ).toBeInTheDocument();
  });

  it("starts from the person's email and explains when they already sign in", async () => {
    renderAt({
      [`GET ${base}/${personId}`]: walkIn({ primaryEmail: email.value, contactPoints: [phone, email] }),
      [`POST ${base}/${personId}/invite`]: () => problem(409, "person.has_login"),
    });
    await userEvent.click(await screen.findByRole("button", { name: "הזמנה לאפליקציה" }));
    const dialog = screen.getByRole("dialog", { name: "הזמנה לאפליקציה" });
    expect(within(dialog).getByRole("textbox", { name: /מייל/ })).toHaveValue("yael@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת הזמנה" }));
    expect(await within(dialog).findByText("לאדם הזה כבר יש חשבון באפליקציה.")).toBeInTheDocument();
  });

  it("shows the API's invalid email on the field", async () => {
    renderAt({
      [`GET ${base}/${personId}`]: walkIn(),
      [`POST ${base}/${personId}/invite`]: () => problem(400, "contact_point.invalid_email"),
    });
    await userEvent.click(await screen.findByRole("button", { name: "הזמנה לאפליקציה" }));
    const dialog = screen.getByRole("dialog", { name: "הזמנה לאפליקציה" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /מייל/ }), "yael@example.c0m");
    await userEvent.click(within(dialog).getByRole("button", { name: "יצירת הזמנה" }));
    expect(await within(dialog).findByText("כתובת מייל לא תקינה")).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["the person already signs in", walkIn({ hasLogin: true }), undefined],
    ["the record is archived", walkIn({ status: "archived" }), undefined],
    ["the member cannot invite", walkIn(), ["organization.view", "members.view", "people.view", "people.manage"]],
  ])("is not offered when %s", async (_, person, permissions) => {
    renderAt({ [`GET ${base}/${personId}`]: person }, permissions);
    expect(await screen.findByRole("heading", { level: 1, name: "יעל" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הזמנה לאפליקציה" })).not.toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;

const person = (id: string, displayName: string, hasLogin: boolean, overrides: Record<string, unknown> = {}) => ({
  id,
  displayName,
  givenName: null,
  familyName: null,
  birthDate: null,
  status: "active",
  source: hasLogin ? "join_link" : "staff_created",
  hasLogin,
  membershipId: null,
  primaryEmail: null,
  primaryPhone: "+972501234567",
  mergedIntoId: null,
  createdAt: "2026-10-15T08:00:00Z",
  version: "1",
  ...overrides,
});
const walkIn = person("0199e5a1-0000-7000-8000-000000000a01", "נועה", false);
const member = person("0199e5a1-0000-7000-8000-000000000a02", "נועה לוי", true);
const candidate = (a = walkIn, b = member) => ({
  id: "0199e5a1-0000-7000-8000-000000000b01",
  reason: "phone",
  status: "open",
  personA: a,
  personB: b,
  createdAt: "2026-10-15T08:00:00Z",
  version: "0",
});

function renderAt(url: string, routesForApi: Record<string, unknown>, auth = signedInAuth()) {
  const api = apiStub({ "POST /api/v1/session": sampleMe, ...routesForApi });
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

describe("duplicates", () => {
  it("merges into the record that signs in", async () => {
    let open = true;
    const api = renderAt("/o/neshima/duplicates", {
      [`GET ${base}/duplicate-candidates`]: () => json({ items: open ? [candidate()] : [], nextBefore: null }),
      [`POST ${base}/duplicate-candidates/${candidate().id}/resolve`]: () => {
        open = false;
        return json({ ...candidate(), status: "merged" });
      },
    });
    const card = await screen.findByRole("region", { name: "נועה ונועה לוי" });
    expect(card).toHaveTextContent("אותו טלפון");
    expect(card).toHaveTextContent("050-123-4567");
    await userEvent.click(
      within(within(card).getByText("נועה לוי").closest(".tp-card--sm") as HTMLElement).getByRole("button", {
        name: "איחוד לרשומה הזו",
      }),
    );

    expect(await screen.findByText("הרשומות אוחדו")).toBeInTheDocument();
    const post = api.requests.findIndex((request) => request.url.endsWith("/resolve"));
    expect(api.bodies[post]).toEqual({ resolution: "merge", survivorPersonId: member.id });
    expect(await screen.findByText("אין כפילויות שמחכות להחלטה.")).toBeInTheDocument();
  });

  it("does not offer a merge when both records sign in, and can mark them as two people", async () => {
    const other = person("0199e5a1-0000-7000-8000-000000000a03", "נועה כהן", true);
    const api = renderAt("/o/neshima/duplicates", {
      [`GET ${base}/duplicate-candidates`]: { items: [candidate(member, other)], nextBefore: null },
      [`POST ${base}/duplicate-candidates/${candidate().id}/resolve`]: () =>
        json({ ...candidate(member, other), status: "not_duplicate" }),
    });
    const card = await screen.findByRole("region", { name: "נועה לוי ונועה כהן" });
    expect(within(card).queryByRole("button", { name: "איחוד לרשומה הזו" })).not.toBeInTheDocument();
    expect(card).toHaveTextContent("לשתי הרשומות יש חשבון");
    await userEvent.click(within(card).getByRole("button", { name: "אלה שני אנשים שונים" }));
    await waitFor(() =>
      expect(api.bodies[api.requests.findIndex((request) => request.url.endsWith("/resolve"))]).toEqual({
        resolution: "not_duplicate",
      }),
    );
  });
});

describe("after a merge", () => {
  it("does not show the survivor's card from before the merge", async () => {
    let merged = false;
    const survivorBefore = {
      ...member,
      contactPoints: [
        {
          id: "0199e5a1-0000-7000-8000-000000000c01",
          type: "phone",
          value: "+972501234567",
          isPrimary: true,
          verified: false,
          version: "1",
        },
      ],
      consents: [],
      relationships: [],
    };
    const survivorAfter = {
      ...survivorBefore,
      contactPoints: [
        ...survivorBefore.contactPoints,
        {
          id: "0199e5a1-0000-7000-8000-000000000c02",
          type: "email",
          value: "moved@example.com",
          isPrimary: true,
          verified: false,
          version: "1",
        },
      ],
    };
    const api = apiStub({
      "POST /api/v1/session": sampleMe,
      [`GET ${base}/people/${member.id}`]: () => json(merged ? survivorAfter : survivorBefore),
      [`GET ${base}/duplicate-candidates`]: () => json({ items: merged ? [] : [candidate()], nextBefore: null }),
      [`POST ${base}/duplicate-candidates/${candidate().id}/resolve`]: () => {
        merged = true;
        return json({ ...candidate(), status: "merged" });
      },
    });
    const router = createMemoryRouter(routes, { initialEntries: [`/o/neshima/people/${member.id}`] });
    render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
    await screen.findByRole("region", { name: "פרטי קשר" });

    await router.navigate("/o/neshima/duplicates");
    const card = await screen.findByRole("region", { name: "נועה ונועה לוי" });
    await userEvent.click(
      within(within(card).getByText("נועה לוי").closest(".tp-card--sm") as HTMLElement).getByRole("button", {
        name: "איחוד לרשומה הזו",
      }),
    );
    await screen.findByText("הרשומות אוחדו");

    await router.navigate(`/o/neshima/people/${member.id}`);
    // The first card that shows is already the merged one: a cached card from before would lack the moved email.
    await screen.findByRole("heading", { level: 1, name: "נועה לוי" });
    expect(screen.getByRole("region", { name: "פרטי קשר" })).toHaveTextContent("moved@example.com");
  });
});

describe("export", () => {
  it("downloads the person's data as JSON", async () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderAt(`/o/neshima/people/${member.id}`, {
      [`GET ${base}/people/${member.id}`]: { ...member, contactPoints: [], consents: [], relationships: [] },
      [`POST ${base}/people/${member.id}/export`]: () =>
        json({
          exportedAt: "2026-10-15T08:00:00Z",
          person: { ...member, contactPoints: [], consents: [], relationships: [] },
          consentHistory: [],
        }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "ייצוא הנתונים" }));
    expect(await screen.findByText("הקובץ ירד. שמרו אותו במקום מאובטח.")).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("offers a fresh sign-in when the API asks for step-up", async () => {
    const redirect = vi.fn();
    renderAt(
      `/o/neshima/people/${member.id}`,
      {
        [`GET ${base}/people/${member.id}`]: { ...member, contactPoints: [], consents: [], relationships: [] },
        [`POST ${base}/people/${member.id}/export`]: problem(401, "auth.step_up_required"),
      },
      signedInAuth({ redirect }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "ייצוא הנתונים" }));
    await userEvent.click(await screen.findByRole("button", { name: "התחברות מחדש" }));
    await waitFor(() => expect(new URL(redirect.mock.calls[0]![0] as string).pathname).toBe("/logout"));
  });
});

describe("erase", () => {
  it("needs a reason, then erases and shows the record as erased", async () => {
    const erased = {
      ...member,
      displayName: "נמחק",
      status: "anonymized",
      hasLogin: false,
      primaryPhone: null,
      contactPoints: [],
      consents: [],
      relationships: [],
    };
    const api = renderAt(`/o/neshima/people/${member.id}`, {
      [`GET ${base}/people/${member.id}`]: { ...member, contactPoints: [], consents: [], relationships: [] },
      [`POST ${base}/people/${member.id}/erase`]: () => json(erased),
    });
    await userEvent.click(await screen.findByRole("button", { name: "מחיקת הנתונים" }));
    const dialog = screen.getByRole("dialog", { name: "מחיקת הנתונים" });
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה לצמיתות" }));
    expect(within(dialog).getByText("כתבו סיבה, 5 תווים לפחות")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole("textbox", { name: /סיבה/ }), "בקשה של המתאמן");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה לצמיתות" }));
    expect(await screen.findByRole("heading", { level: 1, name: "נמחק" })).toBeInTheDocument();
    expect(api.bodies[api.requests.findIndex((request) => request.url.endsWith("/erase"))]).toEqual({
      reason: "בקשה של המתאמן",
    });
    expect(screen.queryByRole("button", { name: "מחיקת הנתונים" })).not.toBeInTheDocument();
  });
});

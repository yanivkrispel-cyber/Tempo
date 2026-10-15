import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const id = (n: number) => `0199e5a1-0000-7000-8000-0000000b${String(n).padStart(4, "0")}`;
const personId = id(1);

const card = {
  id: id(10),
  kind: "punch_card",
  name: "כרטיסיית 10 כניסות",
  entries: 10,
  validDays: 90,
  weeklyCap: null,
  classCategory: null,
  priceAgorot: 52000,
  status: "active",
  version: "1",
};
const twiceAWeek = {
  id: id(11),
  kind: "membership",
  name: "פעמיים בשבוע",
  entries: null,
  validDays: 30,
  weeklyCap: 2,
  classCategory: "pilates",
  priceAgorot: 36000,
  status: "active",
  version: "1",
};
const person = {
  id: personId,
  displayName: "שירה כהן",
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
  createdAt: "2026-10-01T08:00:00Z",
  version: "1",
  contactPoints: [],
  consents: [],
  relationships: [],
};
const pass = (overrides: Record<string, unknown> = {}) => ({
  id: id(20),
  personId,
  product: { id: card.id, name: card.name, kind: "punch_card", weeklyCap: null, classCategory: null },
  startsOn: "2026-10-01",
  endsOn: "2026-12-29",
  entries: 10,
  entriesUsed: 4,
  entriesLeft: 6,
  note: "שולם במזומן",
  status: "active",
  createdAt: "2026-10-01T08:00:00Z",
  version: "1",
  freezes: [],
  ...overrides,
});

function renderAt(url: string, routesForApi: Record<string, unknown>, role: "owner" | "staff" = "owner") {
  const me = { ...sampleMe, memberships: [{ ...studio, role, roles: [], permissions: permissionsFor[role] }] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" },
    [`GET ${base}/class-types`]: { items: [] },
    [`GET ${base}/pass-products`]: { items: [card, twiceAWeek] },
    ...routesForApi,
  });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [url] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

function lastIndex(api: ReturnType<typeof apiStub>, method: string, suffix: string): number {
  const matches = api.requests.map((request, index) =>
    request.method === method && new URL(request.url).pathname.endsWith(suffix) ? index : -1,
  );
  return Math.max(...matches);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T09:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("pass products", () => {
  it("lists what the studio sells", async () => {
    renderAt("/o/neshima/passes", {});
    const cardRow = await screen.findByRole("row", { name: /כרטיסיית 10 כניסות/ });
    expect(cardRow).toHaveTextContent("10 כניסות");
    expect(cardRow).toHaveTextContent("90 ימים");
    expect(cardRow).toHaveTextContent("כל השיעורים");
    expect(cardRow).toHaveTextContent("520");
    const membershipRow = screen.getByRole("row", { name: /פעמיים בשבוע/ });
    expect(membershipRow).toHaveTextContent("עד 2 שיעורים בשבוע");
    expect(membershipRow).toHaveTextContent("רק פילאטיס");
  });

  it("adds a punch card with its price in agorot", async () => {
    const api = renderAt("/o/neshima/passes", {
      [`POST ${base}/pass-products`]: () => json({ ...card, id: id(12), name: "כרטיסיית 5", entries: 5 }, 201),
    });
    await userEvent.click(await screen.findByRole("button", { name: "מוצר חדש" }));
    const dialog = screen.getByRole("dialog", { name: "מוצר חדש" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /שם/ }), "כרטיסיית 5");
    const entries = within(dialog).getByRole("textbox", { name: /כניסות/ });
    await userEvent.clear(entries);
    await userEvent.type(entries, "5");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /מחיר/ }), "99.9");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("המוצר נוסף")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "POST", "/pass-products")]).toEqual({
      kind: "punch_card",
      name: "כרטיסיית 5",
      validDays: 90,
      entries: 5,
      priceAgorot: 9990,
    });
  });

  it("adds a membership with a weekly cap, limited to one category", async () => {
    const api = renderAt("/o/neshima/passes", {
      [`POST ${base}/pass-products`]: () => json(twiceAWeek, 201),
    });
    await userEvent.click(await screen.findByRole("button", { name: "מוצר חדש" }));
    const dialog = screen.getByRole("dialog", { name: "מוצר חדש" });
    await userEvent.click(within(dialog).getByRole("button", { name: "מנוי לתקופה" }));
    expect(within(dialog).queryByRole("textbox", { name: /כניסות/ })).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /שם/ }), "פעמיים בשבוע");
    const days = within(dialog).getByRole("textbox", { name: /תוקף בימים/ });
    await userEvent.clear(days);
    await userEvent.type(days, "30");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "ללא הגבלת שיעורים" }));
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "שיעורים" }), "pilates");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("המוצר נוסף")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "POST", "/pass-products")]).toEqual({
      kind: "membership",
      name: "פעמיים בשבוע",
      validDays: 30,
      weeklyCap: 2,
      classCategory: "pilates",
    });
  });

  it("archives a product after a confirmation", async () => {
    const api = renderAt("/o/neshima/passes", {
      [`POST ${base}/pass-products/${card.id}/archive`]: () => json({ ...card, status: "archived" }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "העברת כרטיסיית 10 כניסות לארכיון" }));
    const dialog = screen.getByRole("dialog", { name: "להפסיק למכור את כרטיסיית 10 כניסות?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "העברה לארכיון" }));
    expect(await screen.findByText("המוצר עבר לארכיון")).toBeInTheDocument();
    expect(lastIndex(api, "POST", "/archive")).toBeGreaterThan(-1);
  });

  it("shows staff the products without the managers' actions", async () => {
    renderAt("/o/neshima/passes", {}, "staff");
    expect(await screen.findByRole("row", { name: /כרטיסיית 10 כניסות/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "מוצר חדש" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /לארכיון/ })).not.toBeInTheDocument();
  });
});

describe("passes on the person card", () => {
  const personRoutes = (passes: unknown[]) => ({
    [`GET ${base}/people/${personId}`]: person,
    [`GET ${base}/people/${personId}/consents`]: { items: [] },
    [`GET ${base}/people/${personId}/passes`]: () => json({ items: passes }),
  });

  it("shows the entries left on a card", async () => {
    renderAt(`/o/neshima/people/${personId}`, personRoutes([pass(), pass({ id: id(21), status: "voided" })]));
    const section = await screen.findByRole("region", { name: "כרטיסיות ומנויים" });
    const items = await within(section).findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("נותרו 6 מתוך 10 כניסות");
    expect(items[0]).toHaveTextContent("01.10.2026 עד 29.12.2026");
    expect(items[0]).toHaveTextContent("שולם במזומן");
    expect(within(items[0]!).getByRole("progressbar", { name: /כניסות שנותרו/ })).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("בוטל");
    expect(within(items[1]!).queryByRole("button", { name: /ביטול/ })).not.toBeInTheDocument();
  });

  it("grants a pass from today, with a note", async () => {
    let granted = false;
    const api = renderAt(`/o/neshima/people/${personId}`, {
      ...personRoutes([]),
      [`GET ${base}/people/${personId}/passes`]: () => json({ items: granted ? [pass()] : [] }),
      [`POST ${base}/people/${personId}/passes`]: () => {
        granted = true;
        return json(pass(), 201);
      },
    });
    const section = await screen.findByRole("region", { name: "כרטיסיות ומנויים" });
    expect(await within(section).findByText(/אין כרטיסייה או מנוי/)).toBeInTheDocument();
    await userEvent.click(within(section).getByRole("button", { name: "מתן כרטיסייה או מנוי" }));
    const dialog = screen.getByRole("dialog", { name: "מתן כרטיסייה או מנוי לשירה כהן" });
    expect(await within(dialog).findByText("10 כניסות · בתוקף 90 ימים · כל השיעורים")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /הערה/ }), "שולם במזומן");
    await userEvent.click(within(dialog).getByRole("button", { name: "מתן" }));

    expect(await screen.findByText("כרטיסיית 10 כניסות ניתן לשירה כהן")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "POST", `/people/${personId}/passes`)]).toEqual({
      productId: card.id,
      note: "שולם במזומן",
    });
    expect(await within(section).findByText(/נותרו 6 מתוך 10 כניסות/)).toBeInTheDocument();
  });

  it("explains an archived product, and voids a pass", async () => {
    const api = renderAt(`/o/neshima/people/${personId}`, {
      ...personRoutes([pass()]),
      [`POST ${base}/people/${personId}/passes`]: problem(409, "pass_product.archived"),
      [`POST ${base}/passes/${id(20)}/void`]: () => json(pass({ status: "voided" })),
    });
    const section = await screen.findByRole("region", { name: "כרטיסיות ומנויים" });
    await userEvent.click(within(section).getByRole("button", { name: "מתן כרטיסייה או מנוי" }));
    const dialog = screen.getByRole("dialog", { name: /מתן כרטיסייה/ });
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: /מוצר/ }), twiceAWeek.id);
    await userEvent.click(within(dialog).getByRole("button", { name: "מתן" }));
    expect(await within(dialog).findByText("המוצר הזה כבר לא נמכר. בחרו מוצר פעיל.")).toBeInTheDocument();
    expect(api.bodies[lastIndex(api, "POST", `/people/${personId}/passes`)]).toEqual({ productId: twiceAWeek.id });
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));

    await userEvent.click(await within(section).findByRole("button", { name: "ביטול כרטיסיית 10 כניסות" }));
    const confirm = screen.getByRole("dialog", { name: "לבטל את כרטיסיית 10 כניסות?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "ביטול הכרטיסייה" }));
    expect(await screen.findByText("הכרטיסייה בוטלה")).toBeInTheDocument();
    expect(lastIndex(api, "POST", "/void")).toBeGreaterThan(-1);
  });

  it("lets staff see passes but not grant them", async () => {
    renderAt(`/o/neshima/people/${personId}`, personRoutes([pass()]), "staff");
    const section = await screen.findByRole("region", { name: "כרטיסיות ומנויים" });
    expect(await within(section).findByText(/נותרו 6 מתוך 10 כניסות/)).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "מתן כרטיסייה או מנוי" })).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /^ביטול/ })).not.toBeInTheDocument();
  });

  describe("freezing a membership", () => {
    const membership = (overrides: Record<string, unknown> = {}) =>
      pass({
        id: id(30),
        product: {
          id: twiceAWeek.id,
          name: twiceAWeek.name,
          kind: "membership",
          weeklyCap: 2,
          classCategory: "pilates",
        },
        entries: null,
        entriesUsed: 0,
        entriesLeft: null,
        endsOn: "2026-12-10",
        note: null,
        ...overrides,
      });
    const freezeRoutes = (passes: unknown[]) => ({
      [`GET ${base}/people/${personId}`]: person,
      [`GET ${base}/people/${personId}/consents`]: { items: [] },
      [`GET ${base}/people/${personId}/passes`]: () => json({ items: passes }),
    });

    it("shows current and upcoming freezes with the extended end, and offers freezing only on a membership", async () => {
      renderAt(
        `/o/neshima/people/${personId}`,
        freezeRoutes([
          membership({
            freezes: [
              { id: id(40), startsOn: "2026-10-10", endsOn: "2026-11-12" },
              { id: id(41), startsOn: "2026-11-20", endsOn: "2026-11-30" },
            ],
          }),
          pass(),
        ]),
      );
      const section = await screen.findByRole("region", { name: "כרטיסיות ומנויים" });
      const freezes = await within(section).findByRole("list", { name: "הקפאות של פעמיים בשבוע" });
      expect(freezes).toHaveTextContent("מוקפא עד 12.11");
      expect(freezes).toHaveTextContent("הקפאה מתוכננת 20.11–30.11");
      expect(freezes).toHaveTextContent("התוקף מוארך עד 10.12.2026");
      // Only the upcoming one can be removed; a started freeze stays.
      expect(within(freezes).getAllByRole("button", { name: /הסרת ההקפאה/ })).toHaveLength(1);
      expect(within(section).getAllByRole("button", { name: /^הקפאת/ })).toHaveLength(1);
      expect(within(section).queryByRole("button", { name: "הקפאת כרטיסיית 10 כניסות" })).not.toBeInTheDocument();
    });

    it("sends the dates, and explains a refusal inside the dialog", async () => {
      let frozen = false;
      let refused = false;
      const api = renderAt(`/o/neshima/people/${personId}`, {
        ...freezeRoutes([membership()]),
        [`GET ${base}/people/${personId}/passes`]: () =>
          json({
            items: [
              membership(frozen ? { freezes: [{ id: id(40), startsOn: "2026-11-01", endsOn: "2026-11-14" }] } : {}),
            ],
          }),
        [`POST ${base}/passes/${id(30)}/freezes`]: () => {
          if (!refused) {
            refused = true;
            return problem(409, "pass.freeze_overlap");
          }
          frozen = true;
          return json(membership(), 201);
        },
      });
      const section = await screen.findByRole("region", { name: "כרטיסיות ומנויים" });
      await userEvent.click(await within(section).findByRole("button", { name: "הקפאת פעמיים בשבוע" }));
      const dialog = screen.getByRole("dialog", { name: "הקפאת פעמיים בשבוע" });
      await userEvent.clear(within(dialog).getByRole("textbox", { name: /תחילת ההקפאה/ }));
      await userEvent.type(within(dialog).getByRole("textbox", { name: /תחילת ההקפאה/ }), "01.11.2026");
      await userEvent.type(within(dialog).getByRole("textbox", { name: /היום האחרון/ }), "14.11.2026");
      await userEvent.click(within(dialog).getByRole("button", { name: "הקפאה" }));
      expect(await within(dialog).findByText("הימים האלה חופפים להקפאה אחרת של המנוי.")).toBeInTheDocument();
      expect(api.bodies[lastIndex(api, "POST", "/freezes")]).toEqual({ startsOn: "2026-11-01", endsOn: "2026-11-14" });

      await userEvent.click(within(dialog).getByRole("button", { name: "הקפאה" }));
      expect(await screen.findByText("המנוי הוקפא")).toBeInTheDocument();
      expect(await within(section).findByText("הקפאה מתוכננת 01.11–14.11")).toBeInTheDocument();
    });

    it("removes an upcoming freeze after a confirmation", async () => {
      const api = renderAt(`/o/neshima/people/${personId}`, {
        ...freezeRoutes([membership({ freezes: [{ id: id(41), startsOn: "2026-11-20", endsOn: "2026-11-30" }] })]),
        [`DELETE ${base}/passes/${id(30)}/freezes/${id(41)}`]: () => json(membership()),
      });
      const section = await screen.findByRole("region", { name: "כרטיסיות ומנויים" });
      await userEvent.click(await within(section).findByRole("button", { name: "הסרת ההקפאה 20.11–30.11" }));
      const dialog = screen.getByRole("dialog", { name: "להסיר את ההקפאה?" });
      await userEvent.click(within(dialog).getByRole("button", { name: "הסרת ההקפאה" }));
      expect(await screen.findByText("ההקפאה הוסרה")).toBeInTheDocument();
      expect(lastIndex(api, "DELETE", `/freezes/${id(41)}`)).toBeGreaterThan(-1);
    });

    it("hides freezing from staff without passes.manage", async () => {
      renderAt(`/o/neshima/people/${personId}`, freezeRoutes([membership()]), "staff");
      const section = await screen.findByRole("region", { name: "כרטיסיות ומנויים" });
      expect(await within(section).findByText(/פעמיים בשבוע/)).toBeInTheDocument();
      expect(within(section).queryByRole("button", { name: /^הקפאת/ })).not.toBeInTheDocument();
    });
  });
});

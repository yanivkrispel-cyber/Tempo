import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { offerLabel, parseWeekly } from "./PublicPageCard";

// MO2 (docs/37 section 4.4, board #404 O2): the studio's public page in the console's settings, with a preview at
// phone and computer width that follows the form, and the instructor's own consent to be shown to strangers (M-14).
const studio = sampleMe.memberships[0]!;
const organizationId = studio.organization.id;
const base = `/api/v1/organizations/${organizationId}`;
const rewardId = "0199e5a1-0000-7000-8000-0000000c0009";

const page = (overrides: Record<string, unknown> = {}) => ({
  enabled: false,
  openJoin: true,
  introProductId: null,
  suggestWeeklyAt: null,
  version: "0",
  instagramHandle: null,
  referralRewardProductId: rewardId,
  listedProducts: [],
  ...overrides,
});

const product = (id: string, name: string, priceAgorot: number | null, status = "active") => ({
  id,
  kind: "punch_card",
  name,
  entries: 1,
  validDays: 30,
  priceAgorot,
  status,
  version: "1",
});
const trial = product("0199e5a1-0000-7000-8000-0000000c0001", "שיעור ניסיון", 4500);
const ten = product("0199e5a1-0000-7000-8000-0000000c0002", "כרטיסייה 10", 65000);
const old = product("0199e5a1-0000-7000-8000-0000000c0003", "מבצע קיץ", 3000, "archived");

function renderSettings(routesForApi: Record<string, unknown>) {
  const me = { ...sampleMe, memberships: [membershipAs("owner")] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}/pass-products`]: { items: [trial, ten, old] },
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

const card = () => screen.findByRole("region", { name: "עמוד ציבורי" });
const preview = () => screen.getByRole("figure", { name: "תצוגה מקדימה של העמוד הציבורי" });

describe("the studio's public page in the settings", () => {
  it("starts off, previews each choice before saving, and saves them all with If-Match", async () => {
    const api = renderSettings({
      [`GET ${base}/public-page`]: page(),
      [`PUT ${base}/public-page`]: () => json(page({ enabled: true, introProductId: trial.id, version: "1" })),
    });
    const region = await card();
    const enabled = await within(region).findByRole("checkbox", { name: "העמוד הציבורי פעיל" });
    expect(enabled).not.toBeChecked();
    expect(within(preview()).getByText(/העמוד כבוי/)).toBeInTheDocument();
    expect(within(region).getByRole("checkbox", { name: "הצטרפות פתוחה" })).toBeDisabled();
    // Only active products are offered.
    const offer = within(region).getByRole("combobox", { name: /הצעה למצטרפים חדשים/ });
    expect(within(offer).queryByRole("option", { name: /מבצע קיץ/ })).not.toBeInTheDocument();
    expect(within(region).queryByRole("textbox", { name: "הקישור לעמוד" })).not.toBeInTheDocument();

    await userEvent.click(enabled);
    expect(within(preview()).getByText("כך העמוד ייראה אחרי השמירה.")).toBeInTheDocument();
    expect(within(preview()).getByText("הצטרפות לסטודיו")).toBeInTheDocument();
    await userEvent.selectOptions(offer, trial.id);
    expect(within(preview()).getByText("שיעור ניסיון · ₪45")).toBeInTheDocument();
    await userEvent.click(within(region).getByRole("checkbox", { name: "הצטרפות פתוחה" }));
    expect(within(preview()).queryByText("הצטרפות לסטודיו")).not.toBeInTheDocument();
    await userEvent.click(within(region).getByRole("checkbox", { name: "הצטרפות פתוחה" }));
    await userEvent.selectOptions(within(region).getByRole("combobox", { name: "יום" }), "sun");
    await userEvent.type(within(region).getByRole("textbox", { name: "האינסטגרם של הסטודיו" }), "@neshima.studio");

    await userEvent.click(within(region).getByRole("button", { name: "שמירה והפעלת העמוד" }));
    await waitFor(() => expect(api.requests.some((request) => request.method === "PUT")).toBe(true));
    const put = api.requests.findIndex((request) => request.method === "PUT");
    expect(api.requests[put]!.headers.get("If-Match")).toBe("0");
    expect(api.bodies[put]).toEqual({
      enabled: true,
      openJoin: true,
      introProductId: trial.id,
      suggestWeeklyAt: "sun 09:00",
      instagramHandle: "@neshima.studio",
      // Not on the form: sent back unchanged.
      referralRewardProductId: rewardId,
    });
  });

  it("shows the page's link and QR once it is on, and a computer's width on demand", async () => {
    renderSettings({
      [`GET ${base}/public-page`]: page({ enabled: true, introProductId: old.id, suggestWeeklyAt: "thu 18:30" }),
      "GET /api/v1/public/studios/neshima/manifest.webmanifest": {
        start_url: "https://app.test/s/neshima/",
        short_name: "נשימה",
      },
    });
    const region = await card();
    expect(await within(region).findByRole("textbox", { name: "הקישור לעמוד" })).toHaveValue(
      "https://app.test/s/neshima/",
    );
    expect(within(region).getByRole("img", { name: "קוד QR לעמוד הציבורי" })).toBeInTheDocument();
    // An archived offer that is still the saved one stays listed, so the form says what is saved.
    expect(within(region).getByRole("combobox", { name: /הצעה למצטרפים חדשים/ })).toHaveValue(old.id);
    expect(within(region).getByRole("combobox", { name: "יום" })).toHaveValue("thu");
    expect(within(region).getByRole("button", { name: "שמירה" })).toBeDisabled();

    const view = within(preview()).getByRole("group", { name: "תצוגה" });
    await userEvent.click(within(view).getByRole("button", { name: "מחשב" }));
    expect(within(view).getByRole("button", { name: "מחשב" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says what the API refused", async () => {
    renderSettings({
      [`GET ${base}/public-page`]: page({ enabled: true }),
      [`PUT ${base}/public-page`]: () => problem(400, "instagramHandle.invalid"),
    });
    const region = await card();
    await userEvent.type(await within(region).findByRole("textbox", { name: "האינסטגרם של הסטודיו" }), "a b");
    await userEvent.click(within(region).getByRole("button", { name: "שמירה" }));
    expect(await within(region).findByText(/שם המשתמש באינסטגרם לא תקין/)).toBeInTheDocument();
  });
});

describe("the products on the public page (SL-4, SL-5)", () => {
  const listedTrial = { productId: trial.id, newcomersOnly: true, publicUntil: "2026-11-30", blurb: "לכל מי שמתחילה" };
  const listedTen = { productId: ten.id, newcomersOnly: false, publicUntil: null, blurb: null };

  function renderListed(listedProducts: unknown[]) {
    return renderSettings({
      [`GET ${base}/public-page`]: page({ enabled: true, listedProducts }),
      [`PUT ${base}/public-page`]: () => json(page({ enabled: true, version: "1", listedProducts })),
    });
  }
  const putBody = (api: ReturnType<typeof apiStub>) =>
    api.bodies[api.requests.findIndex((request) => request.method === "PUT")] as Record<string, unknown>;

  it("lists a product from the active ones only, with its blurb and a last day, and saves the set", async () => {
    const api = renderListed([]);
    const region = await card();
    const add = await within(region).findByRole("combobox", { name: "הוספת מוצר לעמוד" });
    // The archived product cannot be listed.
    expect(within(add).queryByRole("option", { name: /מבצע קיץ/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(add, trial.id);

    await userEvent.type(within(region).getByRole("textbox", { name: "משפט קצר: שיעור ניסיון" }), "לכל מי שמתחילה");
    await userEvent.click(within(region).getByRole("checkbox", { name: "הצעה למצטרפים חדשים", hidden: false }));
    await userEvent.type(
      within(region).getByRole("textbox", { name: "היום האחרון להצעה: שיעור ניסיון" }),
      "30.11.2026",
    );
    await userEvent.click(within(region).getByRole("button", { name: "שמירה" }));

    await waitFor(() => expect(api.requests.some((request) => request.method === "PUT")).toBe(true));
    expect(putBody(api)["listedProducts"]).toEqual([listedTrial]);
  });

  it("reorders and removes products, and sends the new order", async () => {
    const api = renderListed([listedTrial, listedTen]);
    const region = await card();
    expect(await within(region).findByRole("button", { name: "הזזה למעלה: שיעור ניסיון" })).toBeDisabled();
    await userEvent.click(within(region).getByRole("button", { name: "הזזה למעלה: כרטיסייה 10" }));
    const names = within(region)
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("strong", { hidden: true }).textContent);
    expect(names).toEqual(["כרטיסייה 10 · ₪650", "שיעור ניסיון · ₪45"]);
    await userEvent.click(within(region).getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(api.requests.some((request) => request.method === "PUT")).toBe(true));
    expect((putBody(api)["listedProducts"] as { productId: string }[]).map((item) => item.productId)).toEqual([
      ten.id,
      trial.id,
    ]);
  });

  it("leaves an archived product out of the saved set", async () => {
    const archived = { productId: old.id, newcomersOnly: true, publicUntil: null, blurb: null };
    const api = renderListed([archived, listedTen]);
    const region = await card();
    await within(region).findByRole("button", { name: "הסרה מהעמוד: כרטיסייה 10" });
    expect(within(region).queryByText(/מבצע קיץ/, { selector: "strong" })).not.toBeInTheDocument();
    // Untouched: no save, so the archived product is never sent back.
    expect(within(region).getByRole("button", { name: "שמירה" })).toBeDisabled();
    await userEvent.click(within(region).getByRole("button", { name: "הסרה מהעמוד: כרטיסייה 10" }));
    await userEvent.click(within(region).getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(api.requests.some((request) => request.method === "PUT")).toBe(true));
    expect(putBody(api)["listedProducts"]).toEqual([]);
  });
});

describe("the public page's text", () => {
  it("reads the weekly suggestion and says the offer", () => {
    expect(parseWeekly("sun 09:00")).toEqual({ day: "sun", time: "09:00" });
    expect(parseWeekly(null)).toBeNull();
    expect(parseWeekly("sunday 9")).toBeNull();
    expect(offerLabel({ name: "שיעור ניסיון", priceAgorot: 4500 })).toBe("שיעור ניסיון · ₪45");
    expect(offerLabel({ name: "שיעור ניסיון", priceAgorot: null })).toBe("שיעור ניסיון");
  });
});

describe("an instructor's consent to the public page (M-14)", () => {
  const instructor = (membershipId: string, publicProfile: boolean) => ({
    membershipId,
    displayName: "נועה לוי",
    headline: null,
    bio: null,
    instagramHandle: null,
    playlistUrl: null,
    photoUrl: null,
    photoSmallUrl: null,
    visible: true,
    publicProfile,
  });

  function renderMembers(routesForApi: Record<string, unknown>) {
    const me = { ...sampleMe, memberships: [membershipAs("owner")] };
    const api = apiStub({
      "POST /api/v1/session": me,
      [`GET ${base}/members`]: { items: [], nextBefore: null },
      ...routesForApi,
    });
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: ["/o/neshima"] })}
        auth={signedInAuth()}
        apiUrl="https://api.test"
        fetch={api.fetch}
      />,
    );
    return api;
  }

  it("lets the instructor choose it on their own profile and sends it", async () => {
    const api = renderMembers({
      [`GET ${base}/instructors`]: { items: [instructor(studio.membershipId, false)] },
      [`PUT ${base}/me/staff-profile`]: () => json(instructor(studio.membershipId, true)),
    });
    await userEvent.click(await screen.findByRole("button", { name: "פרופיל המדריך שלי" }));
    const dialog = await screen.findByRole("dialog");
    const consent = await within(dialog).findByRole("checkbox", { name: "להציג את הפרופיל שלי גם בעמוד הציבורי" });
    expect(consent).not.toBeChecked();
    await userEvent.click(consent);
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(api.requests.some((request) => request.method === "PUT")).toBe(true));
    const put = api.requests.findIndex((request) => request.method === "PUT");
    expect(api.bodies[put]).toMatchObject({ publicProfile: true, visible: true });
  });
});

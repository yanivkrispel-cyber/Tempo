import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { initials } from "./BrandCard";

// WL3 (docs/35 sections 2 to 5, board #404 O1): the studio's app name, accent, logo and icon in the console's
// settings, with a home-screen preview that follows the form before it is saved.
const studio = sampleMe.memberships[0]!;
const organizationId = studio.organization.id;
const base = `/api/v1/organizations/${organizationId}`;

const brand = (overrides: Record<string, unknown> = {}) => ({
  appName: "סטודיו נשימה",
  accentId: "sage",
  iconBackground: "paper",
  logoUrl: null,
  logoSmallUrl: null,
  iconUrl: null,
  customized: false,
  version: "0",
  ...overrides,
});

const mediaId = "0199e5a1-0000-7000-8000-0000000b0001";
const ticket = {
  mediaId,
  uploadForm: { url: "https://storage.test/tempo-media", fields: { key: `uploads/${mediaId}` } },
  maxBytes: 8 * 1024 * 1024,
  contentType: "image/png",
  expiresAt: "2026-10-20T20:00:00Z",
};

function renderSettings(routesForApi: Record<string, unknown>) {
  const me = { ...sampleMe, memberships: [membershipAs("owner")] };
  const api = apiStub({ "POST /api/v1/session": me, ...routesForApi });
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

const card = () => screen.findByRole("region", { name: "המיתוג של הסטודיו" });
const preview = () => screen.getByRole("figure", { name: "תצוגה במסך הבית" });

afterEach(() => vi.unstubAllGlobals());

describe("the studio's brand in the settings", () => {
  it("previews the defaults on a home screen and saves the whole brand with If-Match", async () => {
    const api = renderSettings({
      [`GET ${base}/brand`]: brand(),
      [`PUT ${base}/brand`]: () => json(brand({ appName: "נשימה", accentId: "ocean", customized: true, version: "1" })),
    });
    const region = await card();
    const name = await within(region).findByRole("textbox", { name: /שם האפליקציה/ });
    expect(name).toHaveValue("סטודיו נשימה");
    // No icon yet: the studio's initials on its accent, as the API draws them (W-2).
    expect(within(preview()).getByText("סנ")).toBeInTheDocument();
    expect(within(preview()).getByText("סטודיו נשימה")).toBeInTheDocument();
    expect(within(region).queryByRole("group", { name: "רקע הסמל" })).not.toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "שמירת המיתוג" })).toBeDisabled();

    await userEvent.clear(name);
    await userEvent.type(name, "נשימה");
    expect(within(preview()).getByText("נשימה")).toBeInTheDocument();
    expect(within(region).getByText("5/12")).toBeInTheDocument();

    const accents = within(region).getByRole("radiogroup", { name: "צבע המותג" });
    expect(within(accents).getAllByRole("radio")).toHaveLength(8);
    await userEvent.click(within(accents).getByRole("radio", { name: "אוקיינוס" }));
    expect(within(accents).getByRole("radio", { name: "אוקיינוס" })).toHaveAttribute("aria-checked", "true");
    expect(preview()).toHaveAttribute("data-accent", "ocean");

    await userEvent.click(within(region).getByRole("button", { name: "שמירת המיתוג" }));
    expect(await screen.findByText("המיתוג נשמר")).toBeInTheDocument();
    const put = api.requests.findIndex((request) => request.method === "PUT");
    expect(api.requests[put]!.headers.get("If-Match")).toBe("0");
    expect(api.bodies[put]).toEqual({ appName: "נשימה", accentId: "ocean", iconBackground: "paper" });
  });

  it("asks for an app name and keeps it to twelve characters", async () => {
    const api = renderSettings({ [`GET ${base}/brand`]: brand() });
    const region = await card();
    const name = await within(region).findByRole("textbox", { name: /שם האפליקציה/ });
    expect(name).toHaveAttribute("maxLength", "12");
    await userEvent.clear(name);
    await userEvent.type(name, "   ");
    await userEvent.click(within(region).getByRole("button", { name: "שמירת המיתוג" }));
    expect(await within(region).findByText("צריך שם של תו אחד לפחות")).toBeInTheDocument();
    expect(api.requests.some((request) => request.method === "PUT")).toBe(false);
  });

  it("moves along the accents with the arrow keys, right to left, as one tab stop", async () => {
    renderSettings({ [`GET ${base}/brand`]: brand() });
    const region = await card();
    const accents = await within(region).findByRole("radiogroup", { name: "צבע המותג" });
    const sage = within(accents).getByRole("radio", { name: "מרווה" });
    expect(
      within(accents)
        .getAllByRole("radio")
        .filter((radio) => radio.tabIndex === 0),
    ).toEqual([sage]);
    sage.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(within(accents).getByRole("radio", { name: "זית" })).toHaveFocus();
    expect(within(accents).getByRole("radio", { name: "זית" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(within(accents).getByRole("radio", { name: "גרפיט" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the icon as it installs, and its background follows the form", async () => {
    renderSettings({
      [`GET ${base}/brand`]: brand({ iconUrl: "https://media.test/icon-512.png", customized: true, version: "4" }),
    });
    const region = await card();
    await waitFor(() =>
      expect(preview().querySelector("img")).toHaveAttribute("src", "https://media.test/icon-512.png"),
    );
    const ground = within(region).getByRole("group", { name: "רקע הסמל" });
    await userEvent.click(within(ground).getByRole("button", { name: "בצבע המותג" }));
    expect(within(ground).getByRole("button", { name: "בצבע המותג" })).toHaveAttribute("aria-pressed", "true");
    expect(within(region).getByText("הסמל יצויר מחדש על הרקע הזה בשמירה.")).toBeInTheDocument();
  });

  it("removes the logo through the picture flow", async () => {
    const api = renderSettings({
      [`GET ${base}/brand`]: brand({
        logoSmallUrl: "https://media.test/logo-400.webp",
        customized: true,
        version: "2",
      }),
      [`DELETE ${base}/media`]: () => new Response(null, { status: 204 }),
    });
    const region = await card();
    await userEvent.click(await within(region).findByRole("button", { name: "הסרת הלוגו" }));
    await waitFor(() => expect(api.requests.some((request) => request.method === "DELETE")).toBe(true));
    const removal = new URL(api.requests.find((request) => request.method === "DELETE")!.url);
    expect(removal.searchParams.get("purpose")).toBe("studio_logo");
    expect(removal.searchParams.get("ownerId")).toBe(organizationId);
  });

  it("explains an icon smaller than 512 pixels in Hebrew", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
    );
    renderSettings({
      [`GET ${base}/brand`]: brand(),
      [`POST ${base}/media/uploads`]: ticket,
      [`POST ${base}/media/uploads/${mediaId}/finalize`]: problem(400, "media.icon_too_small"),
    });
    const region = await card();
    const icon = await within(region).findByRole("group", { name: "סמל למסך הבית" });
    await userEvent.upload(
      icon.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File([new Uint8Array([137, 80, 78, 71])], "icon.png", { type: "image/png" }),
    );
    expect(await within(icon).findByText("הסמל צריך להיות ריבוע של 512 על 512 פיקסלים לפחות.")).toBeInTheDocument();
  });

  it("explains a conflict with someone else's change", async () => {
    renderSettings({
      [`GET ${base}/brand`]: brand(),
      [`PUT ${base}/brand`]: problem(409, "concurrency.conflict"),
    });
    const region = await card();
    await userEvent.click(await within(region).findByRole("radio", { name: "זית" }));
    await userEvent.click(within(region).getByRole("button", { name: "שמירת המיתוג" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("מישהו אחר שינה את הנתונים בינתיים");
  });
});

describe("the initials of a studio without an icon (StudioIcons.Initials)", () => {
  it.each([
    ["סטודיו נשימה", "סנ"],
    ["Flow", "FL"],
    ["yoga by the sea", "YB"],
    ["Studio-9 Pilates", "SP"],
    ["  ", "T"],
  ])("%s → %s", (name, expected) => expect(initials(name)).toBe(expected));
});

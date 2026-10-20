import type { AuthClient } from "@tempo/api-client/auth";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../account/account";
import { apiStub, json, sampleMe } from "../test/api";
import { memoryStorage, signedInAuth, signedOutAuth } from "../test/auth";
import { createStudio, testNow } from "../test/studio";
import { App } from "./App";
import { routes } from "./routes";
import { dressStudioHead, openStudioApp, studioSlugOf, undressStudioHead } from "./studioPath";

vi.mock("./studioPath", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./studioPath")>()),
  openStudioApp: vi.fn(),
}));

const neshima = sampleMe.memberships[0]!;
const gal = {
  ...neshima,
  membershipId: "0199e5a1-0000-7000-8000-000000000012",
  organization: {
    id: "0199e5a1-0000-7000-8000-000000000013",
    slug: "gal",
    displayName: "סטודיו גל",
    status: "active" as const,
  },
};
const twoStudios: Me = { ...sampleMe, memberships: [neshima, gal] };

const manifest = (slug: string, body: Record<string, unknown>) => ({
  [`GET /api/v1/public/studios/${slug}/manifest.webmanifest`]: json(body),
});

const studioRoutes = () => ({
  ...createStudio().routes,
  "POST /api/v1/session": twoStudios,
  ...manifest("neshima", { name: "סטודיו נשימה", short_name: "נשימה", theme_color: "#4A7088" }),
  ...manifest("gal", { name: "סטודיו גל", short_name: "גל", theme_color: "#7a607c" }),
});

function renderAt(url: string, { slug = null as string | null, auth = undefined as AuthClient | undefined } = {}) {
  const basename = slug ? `/s/${slug}` : undefined;
  const router = createMemoryRouter(routes, { initialEntries: [(basename ?? "") + url], basename });
  const api = apiStub(studioRoutes());
  render(
    <div dir="rtl">
      <App
        router={router}
        auth={auth ?? signedInAuth({ basePath: basename })}
        apiUrl="https://api.test"
        fetch={api.fetch}
        now={testNow}
        studioSlug={slug}
      />
    </div>,
  );
  return { router, api };
}

const accent = () => document.documentElement.getAttribute("data-accent");
const link = (rel: string) => document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);

afterEach(() => {
  document.documentElement.removeAttribute("data-accent");
  document.head.innerHTML = "";
  document.title = "";
});

describe("a studio's path", () => {
  it.each([
    ["/s/neshima/bookings", "neshima"],
    ["/s/neshima", "neshima"],
    ["/s/neshima-tlv-2/", "neshima-tlv-2"],
    ["/s/Neshima/", null],
    ["/s/ab/", null],
    ["/sx/neshima", null],
    ["/s/neshima.evil/", null],
    ["/", null],
  ])("reads %s as %s", (path, slug) => {
    expect(studioSlugOf(path)).toBe(slug);
  });

  it("dresses the head in the studio's manifest and icon, and undresses it back to Tempo's", () => {
    const head = document.implementation.createHTMLDocument().head;
    head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-title">';

    dressStudioHead("https://api.test", "neshima", head);
    const manifestLink = head.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    expect(manifestLink.href).toBe("https://api.test/api/v1/public/studios/neshima/manifest.webmanifest");
    expect(manifestLink.crossOrigin).toBe("anonymous");
    expect(head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.href).toBe(
      "https://api.test/api/v1/public/studios/neshima/icons/180",
    );

    undressStudioHead(head);
    expect(manifestLink.getAttribute("href")).toBe("/manifest.webmanifest");
    expect(manifestLink.hasAttribute("crossorigin")).toBe(false);
    expect(head.querySelector('link[rel="apple-touch-icon"]')!.getAttribute("href")).toBe("/apple-touch-icon.png");
    expect(head.ownerDocument.title).toBe("Tempo");
    expect(head.querySelector("meta")!.getAttribute("content")).toBe("Tempo");
  });
});

describe("a studio's own app (/s/<slug>/)", () => {
  it("shows that studio only, with its name and accent, and keeps the links under its path", async () => {
    renderAt("/", { slug: "neshima" });
    expect(await screen.findByText("סטודיו נשימה · יום שלישי, 13.10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /החלפת סטודיו/ })).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("נשימה"));
    expect(accent()).toBe("ocean");
    const nav = screen.getByRole("navigation", { name: "ניווט" });
    expect(within(nav).getByRole("link", { name: "הזמנות" })).toHaveAttribute("href", "/s/neshima/bookings");
  });

  it("shows a studio the member has not joined as not joined, and Tempo's look for a studio the API does not know", async () => {
    dressStudioHead("https://api.test", "gal-yam");
    renderAt("/", { slug: "gal-yam" });
    expect(await screen.findByText("עוד לא הצטרפת לסטודיו")).toBeInTheDocument();
    await waitFor(() => expect(link("manifest")!.getAttribute("href")).toBe("/manifest.webmanifest"));
    expect(document.title).toBe("Tempo");
    expect(link("apple-touch-icon")!.getAttribute("href")).toBe("/apple-touch-icon.png");
  });

  it("signs a visitor in and brings them back inside the studio's app", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    const { router } = renderAt("/bookings", {
      slug: "neshima",
      auth: signedOutAuth({ redirect, flowStorage, basePath: "/s/neshima" }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "התחברות" }));
    expect(router.state.location.search).toBe("?returnTo=%2Fbookings");
    await waitFor(() => expect(redirect).toHaveBeenCalledOnce());
    expect(JSON.parse(flowStorage.getItem("tempo.client-web.signin")!)).toMatchObject({
      returnTo: "/s/neshima/bookings",
    });
  });

  it("loads the studio's app after the sign-in callback, which runs outside it", async () => {
    const redirect = vi.fn();
    const flowStorage = memoryStorage();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 }),
      );
    await signedOutAuth({ redirect, flowStorage, fetch, basePath: "/s/neshima" }).signIn("/bookings");
    const state = new URL(redirect.mock.calls[0]![0] as string).searchParams.get("state")!;

    renderAt(`/auth/callback?code=c0de&state=${state}`, { auth: signedOutAuth({ flowStorage, fetch }) });
    await waitFor(() => expect(openStudioApp).toHaveBeenCalledWith("/s/neshima/bookings"));
  });
});

describe("the generic app's studio switcher", () => {
  it("switches a member of two studios, remembers the choice and wears the studio's accent", async () => {
    renderAt("/");
    const switcher = await screen.findByRole("button", { name: /^סטודיו נשימה.*החלפת סטודיו$/ });
    expect(screen.getByText("יום שלישי, 13.10")).toBeInTheDocument();
    await waitFor(() => expect(accent()).toBe("ocean"));

    await userEvent.click(switcher);
    await userEvent.click(screen.getByRole("menuitem", { name: "סטודיו גל" }));
    expect(await screen.findByRole("button", { name: /^סטודיו גל.*החלפת סטודיו$/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("tempo.client-web.studio")).toBe(gal.organization.id);
    await waitFor(() => expect(accent()).toBe("plum"));
  });

  it("opens the studio a tapped notification names", async () => {
    renderAt(`/inbox?studio=${gal.organization.id}&notification=0199e5a1-0000-7000-8000-000000000901`);
    await waitFor(() => expect(window.localStorage.getItem("tempo.client-web.studio")).toBe(gal.organization.id));
  });

  it("does not show for a member of one studio", async () => {
    const api = apiStub({ ...createStudio().routes });
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: ["/"] })}
        auth={signedInAuth()}
        apiUrl="https://api.test"
        fetch={api.fetch}
        now={testNow}
      />,
    );
    expect(await screen.findByText("סטודיו נשימה · יום שלישי, 13.10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /החלפת סטודיו/ })).not.toBeInTheDocument();
  });
});

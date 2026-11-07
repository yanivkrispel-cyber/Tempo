import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, membershipAs, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { parseFaq } from "./faq";

function renderHelp(contact: unknown, path = "/o/neshima/help") {
  const me = { ...sampleMe, memberships: [membershipAs("staff")] };
  const api: Record<string, unknown> = { "POST /api/v1/session": me };
  if (contact !== undefined) api["GET /api/v1/support-contact"] = contact;
  const stub = apiStub(api);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={stub.fetch} />);
  return { stub, router };
}

describe("parseFaq", () => {
  it("reads sections, questions and paragraphs, and leaves out the editor's note", () => {
    const sections = parseFaq(
      [
        "# שאלות נפוצות",
        "",
        "הערה למי שעורך.",
        "",
        "## תשלומים",
        "",
        "### האם משלמים באפליקציה?",
        "",
        "לא. משלמים כמו היום,",
        "ונותנים ב**מתן כרטיסייה**.",
        "",
        "שורה שנייה.",
        "",
        "## ריק",
      ].join("\r\n"),
    );
    expect(sections).toEqual([
      {
        title: "תשלומים",
        items: [
          {
            question: "האם משלמים באפליקציה?",
            answer: ["לא. משלמים כמו היום, ונותנים ב**מתן כרטיסייה**.", "שורה שנייה."],
          },
        ],
      },
    ]);
  });
});

describe("the help page", () => {
  it("shows the pilot FAQ with the screen names bold, and opens an answer", async () => {
    renderHelp({ contact: null, kind: null });
    expect(await screen.findByRole("heading", { level: 1, name: "עזרה ויצירת קשר" })).toBeInTheDocument();
    const payments = screen.getByRole("region", { name: "תשלומים" });
    await userEvent.click(within(payments).getByText("האם המתאמנים משלמים באפליקציה?"));
    expect(within(payments).getByText("מתן כרטיסייה או מנוי", { selector: "strong" })).toBeVisible();
  });

  it("offers an email contact as a mailto link", async () => {
    renderHelp({ contact: "help@tempo.example", kind: "email" });
    const card = await screen.findByRole("region", { name: "יצירת קשר" });
    expect(within(card).getByRole("link", { name: "help@tempo.example" })).toHaveAttribute(
      "href",
      "mailto:help@tempo.example",
    );
  });

  it("opens a link contact in a new tab, and never a link that is not https", async () => {
    renderHelp({ contact: "https://wa.me/972500000000", kind: "url" });
    const link = within(await screen.findByRole("region", { name: "יצירת קשר" })).getByRole("link", {
      name: "פתיחת שיחה",
    });
    expect(link).toHaveAttribute("href", "https://wa.me/972500000000");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it.each([
    ["none is set", { contact: null, kind: null }],
    ["the link is not https", { contact: "javascript:alert(1)", kind: "url" }],
    ["the read fails", undefined],
  ])("leaves the contact out when %s, and keeps the questions", async (_case, contact) => {
    const { stub } = renderHelp(contact);
    await screen.findByRole("region", { name: "תשלומים" });
    await waitFor(() =>
      expect(stub.requests.some((r) => new URL(r.url).pathname === "/api/v1/support-contact")).toBe(true),
    );
    expect(screen.queryByRole("region", { name: "יצירת קשר" })).not.toBeInTheDocument();
  });

  it("is in the menu for every staff member", async () => {
    const { router } = renderHelp({ contact: null, kind: null }, "/o/neshima/today");
    await userEvent.click(await screen.findByRole("link", { name: "עזרה ויצירת קשר" }));
    expect(router.state.location.pathname).toBe("/o/neshima/help");
  });
});

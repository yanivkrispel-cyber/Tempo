import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { createStudio, testNow } from "../../test/studio";
import { emailMatches } from "./DeleteAccountDialog";

const studioId = sampleMe.memberships[0]!.organization.id;

function renderProfile(deleteMe: unknown = () => new Response(null, { status: 204 })) {
  const redirect = vi.fn();
  const auth = signedInAuth({ redirect });
  const studio = createStudio();
  const api = apiStub({ ...studio.routes, "DELETE /api/v1/me": deleteMe });
  const router = createMemoryRouter(routes, { initialEntries: ["/profile"] });
  render(
    <div dir="rtl">
      <App router={router} auth={auth} apiUrl="https://api.test" fetch={api.fetch} now={testNow} />
    </div>,
  );
  return { api, auth, redirect, router };
}

async function openDialog() {
  await userEvent.click(await screen.findByRole("button", { name: /מחיקת החשבון/ }));
  return screen.findByRole("dialog", { name: "מחיקת החשבון" });
}

const deletes = (api: ReturnType<typeof apiStub>) =>
  api.requests.flatMap((request, index) =>
    request.method === "DELETE" && new URL(request.url).pathname === "/api/v1/me" ? [api.bodies[index]] : [],
  );

describe("deleting my account (A-1, A-2)", () => {
  it("says what goes and what the studio keeps before anything happens", async () => {
    renderProfile();
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("ההתחברות שלך: לא תוכלו להיכנס עם החשבון הזה.");
    expect(dialog).toHaveTextContent("ההתראות בטלפון: המכשירים שלך לא יקבלו עוד התראות.");
    // A-2 as A1 built it (docs/32 section 9): the inbox and the preferences stay with the studio's record.
    expect(dialog).toHaveTextContent(
      "הרשומה שלך בסטודיו: השם, השיעורים, הנוכחות, הכרטיסיות והמנויים, וגם ההודעות שהסטודיו שלח.",
    );
    expect(dialog).not.toHaveTextContent("העדפות ההתראות");
    expect(dialog).toHaveTextContent("כדי לאשר, כתבו noga@example.com");
  });

  it("asks for the account's email typed and sends nothing until it matches", async () => {
    const { api } = renderProfile();
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /כתובת המייל של החשבון/ }), "other@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקת החשבון" }));
    expect(within(dialog).getByText("כתבו את כתובת המייל של החשבון, בדיוק כפי שהיא מופיעה.")).toBeInTheDocument();
    expect(deletes(api)).toHaveLength(0);
  });

  it("deletes with the typed email and signs the person out", async () => {
    const { api, redirect } = renderProfile();
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /כתובת המייל של החשבון/ }), " Noga@Example.com ");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקת החשבון" }));
    await waitFor(() => expect(deletes(api)).toEqual([{ confirmEmail: "Noga@Example.com" }]));
    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith(expect.stringMatching(/\/logout\?client_id=test-client/)),
    );
  });

  it("explains the sole-owner refusal with the studio's name and where to hand it over", async () => {
    const { redirect } = renderProfile(() =>
      json(
        {
          type: "about:blank",
          title: "Sole owner",
          status: 409,
          code: "account.sole_owner",
          organizationIds: [studioId],
        },
        409,
      ),
    );
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /כתובת המייל של החשבון/ }), "noga@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקת החשבון" }));
    const banner = await within(dialog).findByText(/אין בעלים נוסף מלבדך/);
    expect(banner).toHaveTextContent("לסטודיו סטודיו נשימה אין בעלים נוסף מלבדך.");
    expect(banner).toHaveTextContent('בחרו "העברת הבעלות"');
    expect(redirect).not.toHaveBeenCalled();
  });

  it("offers to sign in again when the API wants a recent sign-in", async () => {
    const { redirect } = renderProfile(problem(401, "auth.step_up_required"));
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /כתובת המייל של החשבון/ }), "noga@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקת החשבון" }));
    expect(await within(dialog).findByText(/צריך לאמת שוב את הזהות/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "התחברות מחדש" }));
    // The Hosted UI's logout leads back to the sign-in with the password asked again. signIn is async (it builds the
    // logout URL first), so the redirect comes after the click resolves.
    await waitFor(() => expect(redirect).toHaveBeenCalledWith(expect.stringMatching(/\/logout\?/)));
  });

  it("compares the email without case and spaces at the ends", () => {
    expect(emailMatches("  NOGA@example.com ", "noga@example.com")).toBe(true);
    expect(emailMatches("noga@example.co", "noga@example.com")).toBe(false);
    expect(emailMatches("", "noga@example.com")).toBe(false);
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, sampleMe, signedInRoutes } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!.organization;

function renderPage(deleteMe: unknown = () => new Response(null, { status: 204 })) {
  const redirect = vi.fn();
  const api = apiStub({ ...signedInRoutes, "DELETE /api/v1/me": deleteMe });
  const router = createMemoryRouter(routes, { initialEntries: ["/account/security"] });
  render(<App router={router} auth={signedInAuth({ redirect })} apiUrl="https://api.test" fetch={api.fetch} />);
  return { api, redirect, router };
}

async function confirmWith(email: string) {
  const card = await screen.findByRole("region", { name: "מחיקת החשבון" });
  await userEvent.click(within(card).getByRole("button", { name: "מחיקת החשבון" }));
  const dialog = await screen.findByRole("dialog", { name: "מחיקת החשבון" });
  await userEvent.type(within(dialog).getByRole("textbox", { name: /כתובת המייל של החשבון/ }), email);
  await userEvent.click(within(dialog).getByRole("button", { name: "מחיקת החשבון" }));
  return dialog;
}

const deleteBodies = (api: ReturnType<typeof apiStub>) =>
  api.requests.flatMap((request, index) =>
    request.method === "DELETE" && new URL(request.url).pathname === "/api/v1/me" ? [api.bodies[index]] : [],
  );

describe("deleting my account from the console's account page", () => {
  it("deletes with the typed email and signs out", async () => {
    const { api, redirect } = renderPage();
    await confirmWith("dana@example.com");
    await waitFor(() => expect(deleteBodies(api)).toEqual([{ confirmEmail: "dana@example.com" }]));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith(expect.stringMatching(/\/logout\?/)));
  });

  it("sends nothing while the email doesn't match", async () => {
    const { api } = renderPage();
    const dialog = await confirmWith("someone@example.com");
    expect(within(dialog).getByText("כתבו את כתובת המייל של החשבון, בדיוק כפי שהיא מופיעה.")).toBeInTheDocument();
    expect(deleteBodies(api)).toHaveLength(0);
  });

  it("links the sole owner to the studio where the ownership is handed over", async () => {
    const { redirect } = renderPage(() =>
      json(
        {
          type: "about:blank",
          title: "Sole owner",
          status: 409,
          code: "account.sole_owner",
          organizationIds: [studio.id],
        },
        409,
      ),
    );
    const dialog = await confirmWith("dana@example.com");
    const link = await within(dialog).findByRole("link", { name: "העברת הבעלות בסטודיו נשימה" });
    expect(link).toHaveAttribute("href", `/o/${studio.slug}`);
    expect(redirect).not.toHaveBeenCalled();
  });
});

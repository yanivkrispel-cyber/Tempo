import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;

const roles = {
  items: [
    {
      id: "00000000-0000-7000-8000-000000000001",
      key: "owner",
      displayName: "בעלים",
      isSystem: true,
      permissions: ["organization.view", "ownership.transfer"],
    },
    {
      id: "00000000-0000-7000-8000-000000000004",
      key: "client",
      displayName: "מתאמן",
      isSystem: true,
      permissions: ["organization.view", "future.permission"],
    },
  ],
};

describe("roles", () => {
  it("lists each role with its permissions in Hebrew, and marks the caller's own", async () => {
    const api = apiStub({
      "POST /api/v1/session": sampleMe,
      [`GET /api/v1/organizations/${studio.organization.id}/roles`]: roles,
    });
    render(
      <App
        router={createMemoryRouter(routes, { initialEntries: ["/o/neshima/roles"] })}
        auth={signedInAuth()}
        apiUrl="https://api.test"
        fetch={api.fetch}
      />,
    );

    const owner = await screen.findByRole("region", { name: "בעלים" });
    expect(within(owner).getByText("התפקיד שלך")).toBeInTheDocument();
    expect(within(owner).getByRole("list", { name: "ההרשאות של בעלים" })).toHaveTextContent("העברת הבעלות על הסטודיו");

    const client = screen.getByRole("region", { name: "מתאמן" });
    expect(within(client).queryByText("התפקיד שלך")).not.toBeInTheDocument();
    expect(within(client).getByText("future.permission")).toBeInTheDocument();
    expect(
      within(owner)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["צפייה בפרטי הסטודיו", "העברת הבעלות על הסטודיו"]);
    expect(screen.getByRole("link", { name: "תפקידים" })).toHaveAttribute("aria-current", "page");
  });
});

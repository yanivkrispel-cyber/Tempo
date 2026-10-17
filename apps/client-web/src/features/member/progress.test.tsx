import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { createStudio, testNow, type StudioOptions } from "../../test/studio";
import { goalText, streakText } from "./progress";

function renderAt(url: string, options: StudioOptions = {}) {
  const studio = createStudio(options);
  const api = apiStub(studio.routes);
  render(
    <div dir="rtl">
      <App
        router={createMemoryRouter(routes, { initialEntries: [url] })}
        auth={signedInAuth()}
        apiUrl="https://api.test"
        fetch={api.fetch}

        now={testNow}
      />
    </div>,
  );
  return { studio, api };
}

const goalPuts = (api: ReturnType<typeof apiStub>) =>
  api.requests.flatMap((request, index) =>
    request.method === "PUT" && request.url.endsWith("/me/progress/goal") ? [api.bodies[index]] : [],
  );

describe("progress on the member home (docs/31 section 12)", () => {
  it("shows the API's visits against the goal in a ring, and the streak", async () => {
    renderAt("/", { progress: { visitsThisMonth: 9, monthlyGoal: 12, streakWeeks: 6 } });
    const stats = await screen.findByRole("region", { name: "ההתקדמות שלך" });
    const ring = await within(stats).findByRole("progressbar", { name: "ביקורים החודש: 9 מתוך יעד של 12" });
    expect(ring).toHaveAttribute("aria-valuenow", "9");
    expect(ring).toHaveAttribute("aria-valuemax", "12");
    expect(stats).toHaveTextContent("ביקורים החודש, מתוך 12");
    expect(stats).toHaveTextContent("6 שבועות ברצף");
    // The sample numbers are gone.
    expect(stats).not.toHaveTextContent("14");
    expect(stats).not.toHaveTextContent("שלושה שיעורים");
  });

  it("hides the ring while no goal is set, shows the visits and points to setting one (G-1)", async () => {
    renderAt("/", { progress: { visitsThisMonth: 4, monthlyGoal: null, streakWeeks: 0 } });
    const stats = await screen.findByRole("region", { name: "ההתקדמות שלך" });
    expect(await within(stats).findByText("4")).toHaveClass("tp-stat__value");
    expect(within(stats).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(stats).getByRole("link", { name: "להגדרת יעד חודשי" })).toHaveAttribute("href", "/profile");
    expect(stats).toHaveTextContent("עוד אין רצף שבועי");
  });

  it("says the goal in words: none, one class, several", () => {
    expect(goalText(null)).toBe("לא הוגדר");
    expect(goalText(1)).toBe("שיעור אחד בחודש");
    expect(goalText(12)).toBe("12 שיעורים בחודש");
  });

  it("says the streak in words for one week and for several", () => {
    expect(streakText(0)).toBe("עוד אין רצף שבועי");
    expect(streakText(1)).toBe("שבוע אחד ברצף");
    expect(streakText(2)).toBe("2 שבועות ברצף");
  });
});

describe("the monthly goal on the profile (G-1)", () => {
  it("sets a goal from 1 to 31 and the row shows it", async () => {
    const { api } = renderAt("/profile");
    const row = await screen.findByRole("button", { name: /יעד חודשי/ });
    expect(row).toHaveTextContent("לא הוגדר");
    await userEvent.click(row);

    const dialog = screen.getByRole("dialog", { name: "יעד חודשי" });
    expect(within(dialog).queryByRole("button", { name: "הסרת היעד" })).not.toBeInTheDocument();
    const input = within(dialog).getByRole("spinbutton", { name: /שיעורים בחודש/ });
    await userEvent.type(input, "12");
    await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    expect(await screen.findByText("היעד נשמר")).toBeInTheDocument();
    expect(goalPuts(api)).toEqual([{ monthlyGoal: 12 }]);
    expect(await screen.findByRole("button", { name: /יעד חודשי/ })).toHaveTextContent("12 שיעורים בחודש");
  });

  it("refuses 0, 32 and a fraction before sending anything", async () => {
    const { api } = renderAt("/profile");
    await userEvent.click(await screen.findByRole("button", { name: /יעד חודשי/ }));
    const dialog = screen.getByRole("dialog", { name: "יעד חודשי" });
    const input = within(dialog).getByRole("spinbutton", { name: /שיעורים בחודש/ });
    for (const value of ["0", "32", "2.5"]) {
      await userEvent.clear(input);
      await userEvent.type(input, value);
      await userEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
      expect(input).toHaveAccessibleDescription("מספר שלם בין 1 ל-31");
    }
    expect(goalPuts(api)).toEqual([]);
  });

  it("clears the goal with null, and the home hides the ring again", async () => {
    const { api } = renderAt("/profile", { progress: { monthlyGoal: 8 } });
    const row = await screen.findByRole("button", { name: /יעד חודשי/ });
    expect(row).toHaveTextContent("8 שיעורים בחודש");
    await userEvent.click(row);
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "יעד חודשי" })).getByRole("button", { name: "הסרת היעד" }),
    );

    expect(await screen.findByText("היעד הוסר")).toBeInTheDocument();
    expect(goalPuts(api)).toEqual([{ monthlyGoal: null }]);
    expect(await screen.findByRole("button", { name: /יעד חודשי/ })).toHaveTextContent("לא הוגדר");

    await userEvent.click(screen.getByRole("link", { name: "בית" }));
    const stats = await screen.findByRole("region", { name: "ההתקדמות שלך" });
    expect(within(stats).queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

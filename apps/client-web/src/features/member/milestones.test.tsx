import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { createStudio, organizationId, testNow, type StudioOptions } from "../../test/studio";
import type { MyMilestones } from "./milestones";
import { milestoneLine, milestoneStats } from "./milestones";

const fifty: MyMilestones = {
  attended: 52,
  reached: [10, 25, 50],
  next: 100,
  hoursOnTheMat: 38.4,
  longestWeekStreak: 11,
  usualTime: "20:00",
  topInstructor: "דנה אלון",
};

function renderAt(url: string, milestones: MyMilestones = fifty, options: StudioOptions = {}) {
  const studio = createStudio(options);
  const api = apiStub({
    ...studio.routes,
    [`GET /api/v1/organizations/${organizationId}/me/milestones`]: milestones,
  });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <div dir="rtl">
      <App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} now={testNow} />
    </div>,
  );
  return { router, api };
}

afterEach(() => vi.restoreAllMocks());

describe("milestones (MO5)", () => {
  it("says the line in words and leaves out the numbers it does not have", () => {
    expect(milestoneLine(50)).toBe("השיעור החמישים שלי");
    expect(milestoneLine(25)).toBe("השיעור העשרים וחמישה שלי");
    expect(milestoneStats(fifty)).toEqual([
      { value: "38", label: "שעות על המזרן" },
      { value: "11", label: "שבועות ברצף" },
      { value: "20:00", label: "השעה הקבועה" },
      { value: "דנה אלון", label: "בהנחיה הכי תכופה" },
    ]);
    expect(
      milestoneStats({ ...fifty, hoursOnTheMat: 1, longestWeekStreak: 1, usualTime: null, topInstructor: null }),
    ).toEqual([{ value: "1", label: "שעה על המזרן" }]);
  });

  it("shows her card for a milestone she reached, private to her, and saves it where the browser cannot share files", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    renderAt("/milestone/50");
    expect(await screen.findByRole("heading", { level: 1, name: "אבן דרך" })).toBeInTheDocument();
    expect(
      await screen.findByRole("img", {
        name: "השיעור החמישים שלי, 38 שעות על המזרן, 11 שבועות ברצף, 20:00 השעה הקבועה, דנה אלון בהנחיה הכי תכופה",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("רק את רואה את הכרטיס הזה. הוא יוצא מכאן רק אם תשתפי אותו.")).toBeInTheDocument();
    // jsdom cannot draw, so the share says so instead of sending an empty picture.
    await userEvent.click(screen.getByRole("button", { name: "שיתוף הכרטיס" }));
    expect(await screen.findByText("לא הצלחנו להכין את התמונה")).toBeInTheDocument();
  });

  it("does not show a card for a milestone she has not reached, and says what comes next", async () => {
    renderAt("/milestone/100");
    expect(await screen.findByText("עוד לא הגעת לאבן הדרך הזו")).toBeInTheDocument();
    expect(screen.getByText("עד עכשיו 52 שיעורים. אבן הדרך הבאה: השיעור ה-100.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לשיעורים הקרובים" })).toHaveAttribute("href", "/book");
  });

  it("opens the card from the inbox, and the reward from a friend's first class opens her profile", async () => {
    renderAt("/inbox", fifty, {
      inbox: [
        {
          id: "0199e5a1-0000-7000-8000-000000000b01",
          kind: "member.milestone",
          data: {},
          text: "50",
          title: "הגעת לאבן דרך בסטודיו נשימה",
          body: "הכרטיס שלך מוכן, אם בא לך לשתף.",
          createdAt: "2026-10-13T08:50:00Z",
          readAt: null,
        },
        {
          id: "0199e5a1-0000-7000-8000-000000000b02",
          kind: "member.referral_rewarded",
          data: { passId: "0199e5a1-0000-7000-8000-0000000000f1" },
          createdAt: "2026-10-13T08:30:00Z",
          readAt: null,
        },
      ],
    });
    const list = await screen.findByRole("list", { name: "התראות" });
    const [milestone, reward] = within(list).getAllByRole("listitem");
    expect(milestone).toHaveTextContent("הגעת לאבן דרך בסטודיו נשימה");
    expect(within(milestone!).getByRole("link")).toHaveAttribute("href", "/milestone/50");
    expect(reward).toHaveTextContent("חברה שהזמנת הגיעה לשיעור הראשון");
    expect(reward).toHaveTextContent("קיבלת כרטיסייה מהסטודיו, והיא כבר אצלך בפרופיל.");
    expect(within(reward!).getByRole("link")).toHaveAttribute("href", "/profile");
  });
});

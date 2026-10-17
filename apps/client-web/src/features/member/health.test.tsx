import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, problem } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { createStudio, testNow, type StudioOptions } from "../../test/studio";

// Generic questions only (test/studio.ts healthForm): no real health data, not even in tests.
function renderAt(url: string, options: StudioOptions = {}, override: Record<string, unknown> = {}) {
  const studio = createStudio(options);
  const api = apiStub({ ...studio.routes, ...override });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <div dir="rtl">
      <App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} now={testNow} />
    </div>,
  );
  return { studio, api, router };
}

const signs = (api: ReturnType<typeof apiStub>) =>
  api.requests.flatMap((request, index) =>
    request.method === "POST" && request.url.endsWith("/me/health-declaration") ? [api.bodies[index]] : [],
  );

async function answer(question: RegExp, value: "כן" | "לא") {
  await userEvent.click(within(screen.getByRole("group", { name: question })).getByRole("radio", { name: value }));
}

describe("the health declaration on the profile", () => {
  it("shows the real status and leads to the declaration", async () => {
    const { router } = renderAt("/profile", { health: { status: "missing" } });
    const row = await screen.findByRole("link", { name: /הצהרת בריאות/ });
    expect(await within(row).findByText("חסרה הצהרת בריאות")).toHaveClass("tp-chip--warning");
    await userEvent.click(row);
    expect(router.state.location.pathname).toBe("/profile/health");
    expect(await screen.findByRole("heading", { level: 1, name: "הצהרת בריאות" })).toBeInTheDocument();
  });
});

describe("signing the declaration (docs/31 H-2, H-3)", () => {
  it("marks what is missing and sends nothing until the form is complete", async () => {
    const { api } = renderAt("/profile/health", { health: { status: "missing" } });
    expect(await screen.findByRole("heading", { name: "מילוי ההצהרה" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "חתימה ושליחה" }));

    expect(screen.getAllByText("צריך לענות כן או לא.")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: /^שם מלא/ })).toHaveAccessibleDescription("צריך לכתוב שם מלא.");
    expect(screen.getByText("חסרים פרטים בטופס. הם מסומנים למעלה.")).toBeInTheDocument();
    expect(signs(api)).toEqual([]);
  });

  it("signs for myself: every answer in the form's order, the name trimmed, no guardian; the status follows", async () => {
    const { api } = renderAt("/profile/health", { health: { status: "missing" } });
    await screen.findByRole("heading", { name: "מילוי ההצהרה" });
    await answer(/שאלה ראשונה/, "לא");
    await answer(/שאלה שנייה/, "לא");
    await userEvent.type(screen.getByRole("textbox", { name: /^שם מלא/ }), "  חבר דוגמה ");
    await userEvent.click(screen.getByRole("checkbox", { name: /קראתי את השאלות/ }));
    await userEvent.click(screen.getByRole("button", { name: "חתימה ושליחה" }));

    expect(await screen.findByText("ההצהרה נחתמה. תודה!")).toBeInTheDocument();
    expect(signs(api)).toEqual([
      {
        formVersion: 1,
        answers: [
          { questionId: "q1", answer: false },
          { questionId: "q2", answer: false },
        ],
        signedName: "חבר דוגמה",
        signerRole: "self",
        guardianName: null,
        confirmed: true,
      },
    ]);
    const status = screen.getByRole("region", { name: /המצב שלך/ });
    expect(within(status).getByText("הצהרת בריאות חתומה")).toBeInTheDocument();
    expect(status).toHaveTextContent("חתמת ב-13.10.2026. ההצהרה בתוקף עד 13.10.2027.");
    // The form and what was typed are gone.
    expect(screen.queryByRole("group", { name: "שאלות ההצהרה" })).not.toBeInTheDocument();
  });

  it("a guardian signs with both names, and a yes explains the medical approval", async () => {
    const { api } = renderAt("/profile/health", { health: { status: "missing" } });
    await screen.findByRole("heading", { name: "מילוי ההצהרה" });
    await answer(/שאלה ראשונה/, "כן");
    await answer(/שאלה שנייה/, "לא");
    await userEvent.click(screen.getByRole("radio", { name: "הורה או אפוטרופוס" }));
    await userEvent.type(screen.getByRole("textbox", { name: /המתאמן/ }), "חבר דוגמה");
    await userEvent.type(screen.getByRole("textbox", { name: /ההורה או האפוטרופוס/ }), "הורה דוגמה");
    await userEvent.click(screen.getByRole("checkbox", { name: /קראתי את השאלות/ }));
    await userEvent.click(screen.getByRole("button", { name: "חתימה ושליחה" }));

    expect(await screen.findByText("ההצהרה נשמרה. לפני השיעור הראשון צריך להביא אישור רפואי.")).toBeInTheDocument();
    expect(signs(api)[0]).toMatchObject({
      answers: [
        { questionId: "q1", answer: true },
        { questionId: "q2", answer: false },
      ],
      signedName: "חבר דוגמה",
      signerRole: "guardian",
      guardianName: "הורה דוגמה",
    });
    const status = screen.getByRole("region", { name: /המצב שלך/ });
    expect(within(status).getByText("ממתינה לאישור רפואי")).toBeInTheDocument();
    expect(status).toHaveTextContent("צריך להביא לסטודיו אישור רפואי");
  });

  it("starts over on a new form version when the platform published one meanwhile", async () => {
    const { studio, api } = renderAt("/profile/health", { health: { status: "missing" } });
    await screen.findByRole("heading", { name: "מילוי ההצהרה" });
    studio.health.formVersion = 2;
    await answer(/^שאלה ראשונה לדוגמה, גרסה 1/, "לא");
    await answer(/^שאלה שנייה לדוגמה, גרסה 1/, "לא");
    await userEvent.type(screen.getByRole("textbox", { name: /^שם מלא/ }), "חבר דוגמה");
    await userEvent.click(screen.getByRole("checkbox", { name: /קראתי את השאלות/ }));
    await userEvent.click(screen.getByRole("button", { name: "חתימה ושליחה" }));

    expect(await screen.findByText("הטופס עודכן בינתיים. עברו על השאלות שוב וחתמו.")).toBeInTheDocument();
    const second = await screen.findByRole("group", { name: "שאלה ראשונה לדוגמה, גרסה 2?" });
    expect(within(second).getByRole("radio", { name: "לא" })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: /^שם מלא/ })).toHaveValue("");
    expect(signs(api)).toHaveLength(1);
  });

  it("says so when the server cannot store it now (fail closed, 503)", async () => {
    const studio = createStudio({ health: { status: "missing" } });
    const key = Object.keys(studio.routes).find(
      (route) => route.startsWith("POST") && route.endsWith("/me/health-declaration"),
    )!;
    renderAt("/profile/health", { health: { status: "missing" } }, { [key]: problem(503, "health.key_unavailable") });
    await screen.findByRole("heading", { name: "מילוי ההצהרה" });
    await answer(/שאלה ראשונה/, "לא");
    await answer(/שאלה שנייה/, "לא");
    await userEvent.type(screen.getByRole("textbox", { name: /^שם מלא/ }), "חבר דוגמה");
    await userEvent.click(screen.getByRole("checkbox", { name: /קראתי את השאלות/ }));
    await userEvent.click(screen.getByRole("button", { name: "חתימה ושליחה" }));
    expect(await screen.findByText("אי אפשר לשמור את ההצהרה כרגע. נסו שוב בעוד כמה דקות.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^שם מלא/ })).toHaveValue("חבר דוגמה");
  });
});

describe("the status and what it means for the member", () => {
  it("asks to renew an expired declaration, with the date it ended", async () => {
    renderAt("/profile/health", { health: { status: "expired" } });
    expect(await screen.findByRole("heading", { name: "חתימה מחדש" })).toBeInTheDocument();
    const status = screen.getByRole("region", { name: /המצב שלך/ });
    expect(within(status).getByText("הצהרת הבריאות פגה")).toHaveClass("tp-chip--danger");
    expect(status).toHaveTextContent("ההצהרה שחתמת עליה פגה ב-01.10.2026");
  });

  it("says booking waits for the declaration when the studio requires it", async () => {
    renderAt("/profile/health", { health: { status: "needs_medical_approval", required: true } });
    const status = await screen.findByRole("region", { name: /המצב שלך/ });
    expect(status).toHaveTextContent('ענית "כן" על לפחות אחת מהשאלות');
    expect(status).toHaveTextContent("עד אז אי אפשר להירשם לשיעורים.");
    // Not missing or expired: no form until the member asks to update.
    expect(screen.queryByRole("group", { name: "שאלות ההצהרה" })).not.toBeInTheDocument();
  });

  it("offers to update a signed declaration, and cancelling closes the form", async () => {
    renderAt("/profile/health");
    const status = await screen.findByRole("region", { name: /המצב שלך/ });
    expect(status).toHaveTextContent("חתמת ב-01.10.2026. ההצהרה בתוקף עד 01.10.2027.");
    await userEvent.click(within(status).getByRole("button", { name: "עדכון ההצהרה" }));
    expect(screen.getByRole("heading", { name: "חתימה מחדש" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(screen.queryByRole("group", { name: "שאלות ההצהרה" })).not.toBeInTheDocument();
  });
});

describe("the booking gate (docs/31 H-5)", () => {
  it("explains 409 health.declaration_required in the sheet, with a link to the form", async () => {
    const { router } = renderAt("/book", { health: { status: "missing", required: true } });
    await userEvent.click(await screen.findByRole("button", { name: "הרשמה לשיעור יוגה בהריון ב-19:00" }));
    const sheet = screen.getByRole("dialog", { name: "הרשמה לשיעור יוגה בהריון" });
    await userEvent.click(within(sheet).getByRole("button", { name: "אישור ההרשמה" }));

    expect(await within(sheet).findByText(/הסטודיו מבקש הצהרת בריאות חתומה לפני ההרשמה לשיעורים/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("link", { name: "למילוי הצהרת הבריאות" }));
    expect(router.state.location.pathname).toBe("/profile/health");
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, membershipAs, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";

const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;

const list = {
  items: [
    { kind: "booking.promoted", group: "bookings", customized: [], updatedAt: null },
    { kind: "reminder.class_soon", group: "reminders", customized: ["inbox"], updatedAt: "2026-10-16T10:00:00Z" },
  ],
};

const text = (subject: string, body: string, source: "default" | "studio" = "default") => ({
  subject,
  body,
  source,
  studioVersion: source === "studio" ? 2 : null,
  preview: { subject, body },
});

const template = (inboxSource: "default" | "studio" = "default") => ({
  kind: "reminder.class_soon",
  group: "reminders",
  locale: "he",
  variables: ["person.firstName", "studio.name", "session.classTypeName", "link.session"],
  sampleValues: { "person.firstName": "נועה", "studio.name": "סטודיו נשימה", "session.classTypeName": "ויניאסה" },
  channels: {
    inbox: text("השיעור מתחיל בקרוב", "היי {{person.firstName}}, {{session.classTypeName}} מתחיל בקרוב.", inboxSource),
    push: text("השיעור מתחיל בקרוב", "{{session.classTypeName}} מתחיל בקרוב."),
  },
  version: "7",
});

function renderAt(path: string, routesForApi: Record<string, unknown> = {}, role: "owner" | "staff" = "owner") {
  const me = { ...sampleMe, memberships: [membershipAs(role)] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}/notification-templates`]: list,
    [`GET ${base}/notification-templates/reminder.class_soon`]: template(),
    ...routesForApi,
  });
  render(
    <App
      router={createMemoryRouter(routes, { initialEntries: [path] })}
      auth={signedInAuth()}
      apiUrl="https://api.test"
      fetch={api.fetch}
    />,
  );
  return api;
}

const putOf = (api: ReturnType<typeof apiStub>) => {
  const index = api.requests.findIndex((request) => request.method === "PUT");
  return { request: api.requests[index], body: api.bodies[index] };
};

describe("notification templates", () => {
  it("lists the kinds by group on the settings page and opens one", async () => {
    renderAt("/o/neshima/settings");
    const card = await screen.findByRole("region", { name: "נוסחי ההודעות" });
    const reminders = await within(card).findByRole("region", { name: "תזכורות" });
    expect(within(reminders).getByText("נוסח של הסטודיו בתיבה")).toBeInTheDocument();
    expect(within(within(card).getByRole("region", { name: "הרשמות" })).getByText("נוסח Tempo")).toBeInTheDocument();

    await userEvent.click(within(reminders).getByRole("link", { name: "תזכורת זמן קצר לפני שיעור" }));
    expect(await screen.findByRole("heading", { level: 1, name: "תזכורת זמן קצר לפני שיעור" })).toBeInTheDocument();
  });

  it("is not shown to staff without settings.manage", async () => {
    const api = renderAt("/o/neshima/settings", {}, "staff");
    await screen.findByRole("heading", { level: 1, name: "הגדרות הסטודיו" });
    expect(screen.queryByRole("region", { name: "נוסחי ההודעות" })).not.toBeInTheDocument();
    expect(api.requests.some((request) => request.url.endsWith("/notification-templates"))).toBe(false);
  });

  it("inserts a variable, previews with sample values and saves only the edited channel", async () => {
    const api = renderAt("/o/neshima/settings/templates/reminder.class_soon", {
      [`PUT ${base}/notification-templates/reminder.class_soon`]: json(template("studio")),
    });
    const subject = await screen.findByRole("textbox", { name: "כותרת" });
    const preview = screen.getByRole("group", { name: "תצוגה מקדימה של הודעה בתיבה" });
    expect(preview).toHaveTextContent("היי נועה, ויניאסה מתחיל בקרוב.");

    await userEvent.click(subject);
    await userEvent.type(subject, " ב");
    await userEvent.click(screen.getByRole("button", { name: "שם הסטודיו" }));
    expect(subject).toHaveValue("השיעור מתחיל בקרוב ב{{studio.name}}");
    expect(preview).toHaveTextContent("השיעור מתחיל בקרוב בסטודיו נשימה");

    await userEvent.click(screen.getByRole("button", { name: "שמירת הנוסח" }));
    await screen.findByText("הנוסח נשמר");
    const put = putOf(api);
    expect(put.request?.headers.get("If-Match")).toBe("7");
    expect(put.body).toEqual({
      locale: "he",
      inbox: { subject: "השיעור מתחיל בקרוב ב{{studio.name}}", body: template().channels.inbox.body },
      push: null,
    });
  });

  it("refuses a variable the kind does not offer at its field, before sending", async () => {
    const api = renderAt("/o/neshima/settings/templates/reminder.class_soon");
    const body = await screen.findByRole("textbox", { name: "גוף ההודעה" });
    await userEvent.type(body, " {{{{pass.entriesLeft}}");
    await userEvent.click(screen.getByRole("button", { name: "שמירת הנוסח" }));
    expect(body).toHaveAccessibleDescription("המשתנה {{pass.entriesLeft}} לא קיים בהודעה הזו. בחרו מהרשימה.");
    expect(api.requests.some((request) => request.method === "PUT")).toBe(false);
  });

  it("shows the API's unknown variable at the push field, on the push tab", async () => {
    renderAt("/o/neshima/settings/templates/reminder.class_soon", {
      [`PUT ${base}/notification-templates/reminder.class_soon`]: json(
        {
          type: "about:blank",
          title: "Bad request",
          status: 400,
          code: "template.unknown_variable",
          variable: "studio.phone",
          errors: [{ field: "push.body", code: "template.unknown_variable" }],
        },
        400,
        { "Content-Type": "application/problem+json" },
      ),
    });
    await userEvent.click(await screen.findByRole("tab", { name: "התראה בטלפון" }));
    await userEvent.type(screen.getByRole("textbox", { name: "גוף ההודעה" }), "!");
    await userEvent.click(screen.getByRole("tab", { name: "תיבת ההודעות" }));
    await userEvent.click(screen.getByRole("button", { name: "שמירת הנוסח" }));

    expect(await screen.findByRole("tab", { name: "התראה בטלפון" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "גוף ההודעה" })).toHaveAccessibleDescription(
      "המשתנה {{studio.phone}} לא קיים בהודעה הזו. בחרו מהרשימה.",
    );
  });

  it("sends a channel back to the default and keeps the other as it is", async () => {
    const api = renderAt("/o/neshima/settings/templates/reminder.class_soon", {
      [`GET ${base}/notification-templates/reminder.class_soon`]: template("studio"),
      [`PUT ${base}/notification-templates/reminder.class_soon`]: json(template()),
    });
    await screen.findByText("נוסח של הסטודיו");
    await userEvent.click(screen.getByRole("button", { name: "חזרה לנוסח של Tempo" }));
    await screen.findByText("הנוסח חזר לנוסח של Tempo");
    await waitFor(() => expect(putOf(api).body).toEqual({ locale: "he", inbox: null, push: null }));
  });

  it("previews the push body cut at 120 characters", async () => {
    renderAt("/o/neshima/settings/templates/reminder.class_soon");
    await userEvent.click(await screen.findByRole("tab", { name: "התראה בטלפון" }));
    const body = screen.getByRole("textbox", { name: "גוף ההודעה" });
    await userEvent.clear(body);
    await userEvent.type(body, "א".repeat(130));
    const preview = screen.getByRole("group", { name: "תצוגה מקדימה של התראת פוש" });
    expect(preview).toHaveTextContent(`${"א".repeat(119)}…`);
    expect(screen.getByText(/נחתך בפוש/)).toBeInTheDocument();
  });
});

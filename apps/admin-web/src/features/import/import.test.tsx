import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";

// Made-up people only (public repo, board #321): Hebrew test names, @example.com emails, 050-00000xx numbers.
const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const createdId = "0199e5a1-0000-7000-8000-000000000701";
const existingId = "0199e5a1-0000-7000-8000-000000000702";

const csv = [
  "שם מלא,טלפון,מייל,תאריך לידה",
  "מאיה דמו,050-0000001,maya@example.com,01/05/1990",
  "רון ניסיון,,ron@example.com,",
  "טל בדיקה,12,,",
].join("\r\n");

const totals = (overrides: Record<string, number>) => ({
  rows: 3,
  valid: 0,
  created: 0,
  exists: 1,
  duplicateInFile: 0,
  invalid: 1,
  ...overrides,
});

const dryRun = {
  dryRun: true,
  importId: null,
  totals: totals({ valid: 1 }),
  rows: [
    { line: 2, outcome: "valid", possibleDuplicate: false },
    { line: 3, outcome: "exists", personId: existingId, possibleDuplicate: false },
    { line: 4, outcome: "invalid", field: "phone", code: "phone.invalid", possibleDuplicate: false },
  ],
};

const committed = {
  ...dryRun,
  dryRun: false,
  importId: "0199e5a1-0000-7000-8000-000000000799",
  totals: totals({ valid: 1, created: 1 }),
  rows: [{ ...dryRun.rows[0], outcome: "created", personId: createdId }, dryRun.rows[1], dryRun.rows[2]],
};

function renderAt(url: string, routesForApi: Record<string, unknown> = {}, permissions?: string[]) {
  const me = permissions ? { ...sampleMe, memberships: [{ ...studio, permissions }] } : sampleMe;
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}/people`]: { items: [], nextBefore: null },
    ...routesForApi,
  });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
  return { api, router };
}

const file = (content: BlobPart, name = "members.csv") => new File([content], name, { type: "text/csv" });
const importCalls = (api: ReturnType<typeof apiStub>) =>
  api.requests.flatMap((request, index) =>
    request.url.endsWith("/people/import") ? [api.bodies[index] as { dryRun: boolean; rows: unknown[] }] : [],
  );

describe("the import's way in", () => {
  it("is a button on the people list for whoever holds people.import, and nobody else", async () => {
    renderAt("/o/neshima/people");
    expect(await screen.findByRole("link", { name: "ייבוא מקובץ" })).toHaveAttribute(
      "href",
      "/o/neshima/people/import",
    );
  });

  it("is not on the people list for staff", async () => {
    renderAt("/o/neshima/people", {}, permissionsFor.staff);
    expect(await screen.findByRole("heading", { level: 1, name: "אנשים" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ייבוא מקובץ" })).not.toBeInTheDocument();
  });

  it("says so on the route without people.import, and sends nothing", async () => {
    const { api } = renderAt("/o/neshima/people/import", {}, permissionsFor.staff);
    expect(await screen.findByRole("heading", { level: 1, name: "אין לך הרשאה לייבא אנשים" })).toBeInTheDocument();
    expect(screen.queryByLabelText("בחירת קובץ")).not.toBeInTheDocument();
    expect(importCalls(api)).toEqual([]);
  });
});

describe("importing a file", () => {
  it("reads the file here, proposes the columns, checks every row, then imports the good ones", async () => {
    const { api } = renderAt("/o/neshima/people/import", {
      [`POST ${base}/people/import`]: async (request: Request) =>
        json(((await request.json()) as { dryRun: boolean }).dryRun ? dryRun : committed),
    });
    expect(await screen.findByText(/הקובץ נקרא במכשיר הזה בלבד/)).toBeInTheDocument();

    await userEvent.upload(screen.getByLabelText("בחירת קובץ"), file(csv));
    expect(await screen.findByRole("status")).toHaveTextContent("members.csv: 3 שורות");
    expect(screen.getByRole("combobox", { name: "שם מלא" })).toHaveValue("0");
    expect(screen.getByRole("combobox", { name: "טלפון" })).toHaveValue("1");
    expect(screen.getByRole("combobox", { name: "מייל" })).toHaveValue("2");
    expect(screen.getByRole("combobox", { name: "תאריך לידה" })).toHaveValue("3");
    expect(screen.getByRole("combobox", { name: "שם פרטי" })).toHaveValue("");
    const preview = screen.getByRole("table", { name: "השורות הראשונות בקובץ" });
    expect(within(preview).getAllByRole("row")).toHaveLength(4);
    expect(importCalls(api)).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "בדיקת 3 השורות" }));
    const check = await screen.findByRole("heading", { name: "הבדיקה" });
    expect(check).toHaveFocus();
    expect(importCalls(api)).toEqual([
      {
        dryRun: true,
        rows: [
          {
            line: 2,
            displayName: "מאיה דמו",
            phone: "050-0000001",
            email: "maya@example.com",
            birthDate: "01/05/1990",
          },
          { line: 3, displayName: "רון ניסיון", email: "ron@example.com" },
          { line: 4, displayName: "טל בדיקה", phone: "12" },
        ],
      },
    ]);
    const results = screen.getByRole("table", { name: "התוצאה לכל שורה" });
    const [, maya, ron, tal] = within(results).getAllByRole("row");
    expect(maya).toHaveTextContent("ייווצר");
    expect(ron).toHaveTextContent("כבר בסטודיו");
    expect(within(ron!).getByRole("link", { name: "רון ניסיון" })).toHaveAttribute(
      "href",
      `/o/neshima/people/${existingId}`,
    );
    expect(tal).toHaveTextContent("לא תקין");
    expect(tal).toHaveTextContent("מספר הטלפון לא תקין");

    await userEvent.click(screen.getByRole("button", { name: "ייבוא אדם אחד" }));
    expect(await screen.findByRole("heading", { name: "אדם אחד נוסף לסטודיו" })).toHaveFocus();
    expect(importCalls(api)[1]).toMatchObject({ dryRun: false, rows: importCalls(api)[0]!.rows });
    expect(screen.getByRole("link", { name: "מאיה דמו" })).toHaveAttribute("href", `/o/neshima/people/${createdId}`);
    expect(screen.getByText(/לא נשלחו הזמנות או הודעות/)).toBeInTheDocument();
  });

  it("lets the person change a column, which drops the old check, and asks for a name and a contact first", async () => {
    const { api } = renderAt("/o/neshima/people/import", { [`POST ${base}/people/import`]: dryRun });
    await userEvent.upload(await screen.findByLabelText("בחירת קובץ"), file(csv));
    await userEvent.click(await screen.findByRole("button", { name: "בדיקת 3 השורות" }));
    expect(await screen.findByRole("heading", { name: "הבדיקה" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "שם מלא" }), "לא בקובץ");
    expect(screen.queryByRole("heading", { name: "הבדיקה" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "בדיקת 3 השורות" }));
    expect(screen.getByText("בחרו עמודה לשם, ולפחות עמודה אחת לטלפון או למייל.")).toBeInTheDocument();
    expect(importCalls(api)).toHaveLength(1);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "שם פרטי" }), "שם מלא");
    await userEvent.click(screen.getByRole("button", { name: "בדיקת 3 השורות" }));
    await waitFor(() => expect(importCalls(api)).toHaveLength(2));
    expect(importCalls(api)[1]!.rows[0]).toEqual({
      line: 2,
      givenName: "מאיה דמו",
      phone: "050-0000001",
      email: "maya@example.com",
      birthDate: "01/05/1990",
    });
  });

  it("explains a file it can't take: too many rows, or an Excel workbook", async () => {
    renderAt("/o/neshima/people/import");
    const lines = ["שם,מייל", ...Array.from({ length: 1001 }, (_, i) => `ניסוי ${i},e2e-${i}@example.com`)];
    await userEvent.upload(await screen.findByLabelText("בחירת קובץ"), file(lines.join("\n")));
    expect(await screen.findByRole("alert")).toHaveTextContent("בקובץ יש 1,001 שורות, ואפשר לייבא עד 1,000 בכל פעם.");
    expect(screen.queryByRole("button", { name: /בדיקת/ })).not.toBeInTheDocument();

    await userEvent.upload(screen.getByLabelText("בחירת קובץ"), file(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14])));
    expect(await screen.findByRole("alert")).toHaveTextContent("זה קובץ של אקסל או של גיליון אחר.");
  });

  it("shows the API's refusal of a check in words", async () => {
    renderAt("/o/neshima/people/import", { [`POST ${base}/people/import`]: problem(402, "billing.restricted") });
    await userEvent.upload(await screen.findByLabelText("בחירת קובץ"), file(csv));
    await userEvent.click(await screen.findByRole("button", { name: "בדיקת 3 השורות" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("המנוי של הסטודיו מושהה");
    expect(screen.queryByRole("heading", { name: "הבדיקה" })).not.toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { routes } from "../../app/routes";
import { apiStub, json, problem, sampleMe } from "../../test/api";
import { signedInAuth } from "../../test/auth";
import { permissionsFor } from "../../test/permissions";
import { proposePassMapping, readImportBytes, toPassImportRows } from "../import/csv";

// Made-up people only (public repo): @example.com emails, 050-00000xx numbers.
const studio = sampleMe.memberships[0]!;
const base = `/api/v1/organizations/${studio.organization.id}`;
const personId = "0199e5a1-0000-7000-8000-000000000801";
// Sells passes, but only owners and admins import.
const withoutImport = permissionsFor.owner.filter((permission) => permission !== "people.import");

const card = {
  id: "0199e5a1-0000-7000-8000-000000000811",
  kind: "punch_card",
  name: "כרטיסיית 10",
  entries: 10,
  validDays: 90,
  weeklyCap: null,
  classCategory: null,
  priceAgorot: null,
  status: "active",
  version: "1",
};
const membership = {
  ...card,
  id: "0199e5a1-0000-7000-8000-000000000812",
  kind: "membership",
  name: "מנוי חודשי",
  entries: null,
};
const archived = { ...card, id: "0199e5a1-0000-7000-8000-000000000813", name: "כרטיסייה ישנה", status: "archived" };

const csv = [
  "מייל,טלפון,מוצר,כניסות שנותרו,בתוקף עד",
  "maya@example.com,,כרטיסיית 10,4,31/12/2026",
  ",050-0000002,מנוי חודשי,,30/11/2026",
  "nobody@example.com,,כרטיסיית 10,4,31/12/2026",
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
    { line: 2, outcome: "valid", personId },
    { line: 3, outcome: "exists", personId, passId: "0199e5a1-0000-7000-8000-000000000821" },
    { line: 4, outcome: "invalid", field: "person", code: "person.not_found" },
  ],
};

const committed = {
  ...dryRun,
  dryRun: false,
  importId: "0199e5a1-0000-7000-8000-000000000899",
  totals: totals({ valid: 1, created: 1 }),
  rows: [{ ...dryRun.rows[0], outcome: "created" }, dryRun.rows[1], dryRun.rows[2]],
};

function renderAt(url: string, routesForApi: Record<string, unknown> = {}, permissions = permissionsFor.owner) {
  const me = { ...sampleMe, memberships: [{ ...studio, permissions }] };
  const api = apiStub({
    "POST /api/v1/session": me,
    [`GET ${base}`]: { ...studio.organization, timeZone: "Asia/Jerusalem", version: "1" },
    [`GET ${base}/class-types`]: { items: [] },
    [`GET ${base}/pass-products`]: { items: [card, membership, archived] },
    ...routesForApi,
  });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<App router={router} auth={signedInAuth()} apiUrl="https://api.test" fetch={api.fetch} />);
  return { api, router };
}

const file = (content: BlobPart, name = "passes.csv") => new File([content], name, { type: "text/csv" });
const importCalls = (api: ReturnType<typeof apiStub>) =>
  api.requests.flatMap((request, index) =>
    request.url.endsWith("/passes/import") ? [api.bodies[index] as { dryRun: boolean; rows: unknown[] }] : [],
  );
const answer = (body: unknown = dryRun, done: unknown = committed) => ({
  [`POST ${base}/passes/import`]: async (request: Request) =>
    json(((await request.json()) as { dryRun: boolean }).dryRun ? body : done),
});

async function pick(user: ReturnType<typeof userEvent.setup>, content: BlobPart = csv) {
  await screen.findByText(/הקובץ נקרא במכשיר הזה בלבד/);
  await user.upload(screen.getByLabelText("בחירת קובץ"), file(content));
  await screen.findByRole("heading", { name: "העמודות" });
}

describe("the pass file's columns", () => {
  it("finds the columns from Hebrew and English headers, and a semicolon file's separator", () => {
    expect(proposePassMapping(["דוא״ל", "נייד", "שם מוצר", "יתרה", "תחילת תוקף", "תוקף עד"])).toEqual({
      email: 0,
      phone: 1,
      product: 2,
      entriesLeft: 3,
      validFrom: 4,
      validUntil: 5,
    });
    expect(proposePassMapping(["Email", "Product", "Entries left", "Valid until"])).toEqual({
      email: 0,
      product: 1,
      entriesLeft: 2,
      validUntil: 3,
    });
    const read = readImportBytes(new TextEncoder().encode("מוצר;תוקף עד\nכרטיסיית 10, בוקר;31/12/2026\n"));
    expect(read.ok && read.file.separator).toBe(";");
  });

  it("sends each mapped cell trimmed and leaves an empty one out", () => {
    const rows = [{ line: 2, cells: [" maya@example.com ", "", "מנוי חודשי"] }];
    expect(toPassImportRows(rows, { email: 0, phone: 1, product: 2 })).toEqual([
      { line: 2, email: "maya@example.com", product: "מנוי חודשי" },
    ]);
  });
});

describe("the pass import's way in", () => {
  it("is a button on the products page for whoever holds both permissions", async () => {
    renderAt("/o/neshima/passes");
    expect(await screen.findByRole("link", { name: "ייבוא כרטיסיות ומנויים" })).toHaveAttribute(
      "href",
      "/o/neshima/passes/import",
    );
  });

  it("is not there for someone who may sell passes but not import", async () => {
    renderAt("/o/neshima/passes", {}, withoutImport);
    expect(await screen.findByRole("heading", { level: 1, name: "כרטיסיות ומנויים" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ייבוא כרטיסיות ומנויים" })).not.toBeInTheDocument();
  });

  it("says so on the route without the permissions, and sends nothing", async () => {
    const { api } = renderAt("/o/neshima/passes/import", {}, withoutImport);
    expect(
      await screen.findByRole("heading", { level: 1, name: "אין לך הרשאה לייבא כרטיסיות ומנויים" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("בחירת קובץ")).not.toBeInTheDocument();
    expect(importCalls(api)).toEqual([]);
  });
});

describe("the page before the file", () => {
  it("sends you to the people import first and lists the active products by name", async () => {
    renderAt("/o/neshima/passes/import");
    expect(await screen.findByRole("link", { name: "לייבוא האנשים" })).toHaveAttribute(
      "href",
      "/o/neshima/people/import",
    );
    const products = await screen.findByRole("region", { name: "המוצרים בסטודיו" });
    expect(await within(products).findByText("כרטיסיית 10")).toBeInTheDocument();
    expect(within(products).getByText("מנוי חודשי")).toBeInTheDocument();
    expect(within(products).queryByText("כרטיסייה ישנה")).not.toBeInTheDocument();
  });

  it("says when the studio has no active product yet", async () => {
    renderAt("/o/neshima/passes/import", { [`GET ${base}/pass-products`]: { items: [archived] } });
    expect(await screen.findByText(/אין עדיין מוצרים פעילים/)).toBeInTheDocument();
  });
});

describe("importing a file", () => {
  it("reads the file here, proposes the columns, checks every row, then imports the good ones", async () => {
    const user = userEvent.setup();
    const { api } = renderAt("/o/neshima/passes/import", answer());
    await pick(user);
    expect(screen.getByLabelText("מוצר")).toHaveDisplayValue("מוצר");
    expect(screen.getByLabelText("בתוקף מתאריך")).toHaveDisplayValue("לא בקובץ");

    await user.click(screen.getByRole("button", { name: "בדיקת 3 השורות" }));
    const check = await screen.findByRole("region", { name: "הבדיקה" });
    expect(within(check).getByText("אין בסטודיו אדם עם הטלפון או המייל האלה. קודם מייבאים את האנשים.")).toBeVisible();
    expect(within(check).getByText("כבר יובא לאדם הזה אותו מוצר עם אותו תאריך סיום. לא נוסף דבר.")).toBeVisible();
    expect(importCalls(api)).toEqual([
      {
        dryRun: true,
        rows: [
          { line: 2, email: "maya@example.com", product: "כרטיסיית 10", entriesLeft: "4", validUntil: "31/12/2026" },
          { line: 3, phone: "050-0000002", product: "מנוי חודשי", validUntil: "30/11/2026" },
          { line: 4, email: "nobody@example.com", product: "כרטיסיית 10", entriesLeft: "4", validUntil: "31/12/2026" },
        ],
      },
    ]);

    await user.click(within(check).getByRole("button", { name: "ייבוא כרטיסייה או מנוי אחד" }));
    expect(await screen.findByRole("heading", { name: "נוספו לסטודיו: כרטיסייה או מנוי אחד" })).toHaveFocus();
    expect(importCalls(api)[1]?.dryRun).toBe(false);
    expect(screen.getByRole("link", { name: "maya@example.com" })).toHaveAttribute(
      "href",
      `/o/neshima/people/${personId}`,
    );
  });

  it("will not check without a contact, a product and an end date column", async () => {
    const user = userEvent.setup();
    const { api } = renderAt("/o/neshima/passes/import", answer());
    await pick(user, "מוצר,הערה\nכרטיסיית 10,משהו\n");
    await user.click(screen.getByRole("button", { name: "בדיקת השורה" }));
    expect(await screen.findByText(/בחרו עמודה למוצר/)).toBeInTheDocument();
    expect(importCalls(api)).toEqual([]);
  });

  it("shows a Hebrew reason for every code the API gives", async () => {
    const codes = [
      ["phone", "phone.invalid", "מספר הטלפון לא תקין"],
      ["email", "email.invalid", "כתובת המייל לא תקינה"],
      ["contact", "contact.required", "חסר טלפון או מייל"],
      ["person", "person.ambiguous", "הטלפון או המייל מתאימים ליותר מאדם אחד. אפשר להוסיף את הכרטיסייה מכרטיס האדם."],
      ["person", "person.read_only", "האדם לא פעיל בסטודיו, ולכן אי אפשר להוסיף לו כרטיסייה או מנוי"],
      ["product", "required", "חסר שם מוצר"],
      ["product", "product.not_found", "אין מוצר פעיל בשם הזה. השמות מופיעים ברשימת המוצרים למעלה."],
      ["product", "product.ambiguous", "יש יותר ממוצר פעיל אחד בשם הזה"],
      ["entries_left", "required", "בכרטיסייה צריך לרשום כמה כניסות נותרו"],
      ["entries_left", "entries_left.invalid", "מספר הכניסות צריך להיות מספר שלם, 1 ומעלה"],
      ["entries_left", "entries_left.too_many", "יותר כניסות ממה שיש במוצר"],
      ["entries_left", "entries_left.not_allowed", "למנוי אין כניסות. השאירו את התא ריק."],
      ["valid_until", "required", "חסר תאריך סיום"],
      ["valid_until", "date.invalid", "תאריך הסיום לא תקין. למשל 31/12/2026"],
      ["valid_until", "valid_until.past", "תאריך הסיום כבר עבר"],
      ["valid_until", "valid_until.too_far", "תאריך הסיום רחוק מדי: עד שנתיים מהיום"],
      ["valid_from", "date.invalid", "תאריך ההתחלה לא תקין. למשל 01/11/2026"],
      ["valid_from", "valid_from.after_until", "תאריך ההתחלה אחרי תאריך הסיום"],
    ] as const;
    const lines = codes.map((_, index) => `row${index}@example.com,כרטיסיית 10,31/12/2026`);
    const user = userEvent.setup();
    renderAt(
      "/o/neshima/passes/import",
      answer({
        dryRun: true,
        importId: null,
        totals: totals({ rows: codes.length, exists: 0, invalid: codes.length }),
        rows: codes.map(([field, code], index) => ({ line: index + 2, outcome: "invalid", field, code })),
      }),
    );
    await pick(user, ["מייל,מוצר,בתוקף עד", ...lines].join("\n"));
    await user.click(screen.getByRole("button", { name: `בדיקת ${codes.length} השורות` }));
    const check = await screen.findByRole("region", { name: "הבדיקה" });
    for (const [, , reason] of codes) expect(within(check).getByText(reason)).toBeVisible();
    expect(within(check).getByText("אין בקובץ כרטיסיות או מנויים חדשים לייבא.")).toBeVisible();
    expect(within(check).queryByRole("button", { name: /^ייבוא/ })).not.toBeInTheDocument();
  });

  it("names the earlier row of a repeat in the file", async () => {
    const user = userEvent.setup();
    renderAt(
      "/o/neshima/passes/import",
      answer({
        ...dryRun,
        rows: [dryRun.rows[0], { line: 3, outcome: "duplicate_in_file", personId, duplicateOfLine: 2 }, dryRun.rows[2]],
      }),
    );
    await pick(user);
    await user.click(screen.getByRole("button", { name: "בדיקת 3 השורות" }));
    expect(await screen.findByText("אותו אדם ואותו מוצר כמו בשורה 2")).toBeInTheDocument();
  });

  it("makes the check stale when a column changes", async () => {
    const user = userEvent.setup();
    renderAt("/o/neshima/passes/import", answer());
    await pick(user);
    await user.click(screen.getByRole("button", { name: "בדיקת 3 השורות" }));
    await screen.findByRole("region", { name: "הבדיקה" });
    await user.selectOptions(screen.getByLabelText("בתוקף מתאריך"), "בתוקף עד");
    await waitFor(() => expect(screen.queryByRole("region", { name: "הבדיקה" })).not.toBeInTheDocument());
  });

  it("shows the API's refusal on the check and keeps the file", async () => {
    const user = userEvent.setup();
    renderAt("/o/neshima/passes/import", {
      [`POST ${base}/passes/import`]: () => problem(402, "billing.restricted"),
    });
    await pick(user);
    await user.click(screen.getByRole("button", { name: "בדיקת 3 השורות" }));
    expect(await screen.findByText(/המנוי של הסטודיו מושהה/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "העמודות" })).toBeInTheDocument();
  });
});

import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../../support/axe";
import { hasSession, noSessionMessage, sessionStatePath, studioSlug } from "../../support/env";

test.skip(!hasSession(sessionStatePath), noSessionMessage);

// The smoke studio's passes stay as they are: the browser answers the import itself, so nothing is written to dev.
// Made-up rows only (E-1).
const csv = [
  "מייל,טלפון,מוצר,כניסות שנותרו,בתוקף עד",
  "e2e-a@example.com,,e2e כרטיסייה,4,31/12/2026",
  ",050-0000002,e2e מנוי,,30/11/2026",
  "e2e-b@example.com,,e2e כרטיסייה,99,31/12/2026",
  "e2e-c@example.com,,e2e לא קיים,4,31/12/2026",
].join("\r\n");

const totals = { rows: 4, valid: 2, created: 0, exists: 0, duplicateInFile: 0, invalid: 2 };
const rows = [
  { line: 2, outcome: "valid" },
  { line: 3, outcome: "valid" },
  { line: 4, outcome: "invalid", field: "entries_left", code: "entries_left.too_many" },
  { line: 5, outcome: "invalid", field: "product", code: "product.not_found" },
];

for (const width of [360, 1280]) {
  test(`pass import at ${width} px: the file, the check and the result (O3)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.route(/\/api\/v1\/organizations\/[^/]+\/passes\/import$/, async (route) => {
      const { dryRun } = route.request().postDataJSON() as { dryRun: boolean };
      await route.fulfill({
        json: dryRun
          ? { dryRun, importId: null, totals, rows }
          : {
              dryRun,
              importId: "0199e5a1-0000-7000-8000-000000000899",
              totals: { ...totals, created: 2 },
              rows: rows.map((row) => (row.outcome === "valid" ? { ...row, outcome: "created" } : row)),
            },
      });
    });

    await page.goto(`/o/${studioSlug}/passes`);
    await page.getByRole("link", { name: "ייבוא כרטיסיות ומנויים" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "ייבוא כרטיסיות ומנויים" })).toBeVisible();
    await expect(page.getByRole("link", { name: "לייבוא האנשים" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, `pass import, the start, ${width} px`);
    await page.screenshot({ path: testInfo.outputPath(`start-${width}.png`), fullPage: true });

    await page.getByLabel("בחירת קובץ").setInputFiles({
      name: "passes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await expect(page.getByLabel("מוצר", { exact: true })).toHaveValue("2");
    await expectNoSeriousA11yViolations(page, testInfo, `pass import, the columns, ${width} px`);
    await page.screenshot({ path: testInfo.outputPath(`columns-${width}.png`), fullPage: true });

    await page.getByRole("button", { name: "בדיקת 4 השורות" }).click();
    const check = page.getByRole("region", { name: "הבדיקה" });
    await expect(check.getByText("יותר כניסות ממה שיש במוצר")).toBeVisible();
    await expect(check.getByText("אין מוצר פעיל בשם הזה. השמות מופיעים ברשימת המוצרים למעלה.")).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, `pass import, the check, ${width} px`);
    await check.screenshot({ path: testInfo.outputPath(`check-${width}.png`) });

    await check.getByRole("button", { name: "ייבוא 2 כרטיסיות ומנויים" }).click();
    await expect(page.getByRole("heading", { name: "נוספו לסטודיו: 2 כרטיסיות ומנויים" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, `pass import, the result, ${width} px`);
    await page.screenshot({ path: testInfo.outputPath(`done-${width}.png`), fullPage: true });

    // D15: nothing runs past the screen's edge.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("the products page with the import button, at both widths (O3)", async ({ page }, testInfo) => {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto(`/o/${studioSlug}/passes`);
    await expect(page.getByRole("link", { name: "ייבוא כרטיסיות ומנויים" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`products-${width}.png`) });
  }
});

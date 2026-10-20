// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("index.html", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

  it("is Hebrew and right-to-left", () => {
    expect(html).toMatch(/<html lang="he" dir="rtl"[ >]/);
  });

  it("sends no referrer, so a page URL never leaks to another origin", () => {
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });
});

import tokens from "@tempo/design-system/tokens.json";
import { afterEach, describe, expect, it } from "vitest";
import { ACCENTS, DEFAULT_ACCENT, applyAccent, isAccentId } from "./accent";

// The design system's tokens.json is the source of the eight accents (WL2, docs/35 section 3).

describe("accents", () => {
  afterEach(() => document.documentElement.removeAttribute("data-accent"));

  it("lists the design system's eight accents, with their Hebrew labels, in its order", () => {
    expect(ACCENTS.map(({ id, label }) => ({ id, label }))).toEqual(
      tokens.accents.list.map(({ id, label }) => ({ id, label })),
    );
    expect(DEFAULT_ACCENT).toBe(tokens.accents.default);
  });

  it("knows an accent id and refuses anything else", () => {
    expect(isAccentId("ocean")).toBe(true);
    expect(isAccentId("#ff0000")).toBe(false);
    expect(isAccentId("Ocean")).toBe(false);
    expect(isAccentId(undefined)).toBe(false);
  });

  it("sets data-accent on <html>, and falls back to sage for an unknown or missing id", () => {
    expect(applyAccent("plum")).toBe("plum");
    expect(document.documentElement.getAttribute("data-accent")).toBe("plum");
    expect(applyAccent("neon")).toBe("sage");
    expect(document.documentElement.getAttribute("data-accent")).toBe("sage");
    applyAccent("rose");
    expect(applyAccent(null)).toBe("sage");
    expect(document.documentElement.getAttribute("data-accent")).toBe("sage");
  });
});

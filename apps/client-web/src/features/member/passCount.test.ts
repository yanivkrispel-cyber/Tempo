import { describe, expect, it } from "vitest";
import { passesCardHeight, rememberedPassCount, rememberPassCount } from "./passCount";

describe("the remembered pass count (board #537, O2)", () => {
  it("knows nothing until the profile has shown the studio's passes, and sizes that as one pass", () => {
    expect(rememberedPassCount("org-1")).toBeNull();
    expect(passesCardHeight(null)).toBe(188);
  });

  it("remembers each studio's count and sizes the card by it", () => {
    rememberPassCount("org-1", 2);
    rememberPassCount("org-2", 3);
    expect(rememberedPassCount("org-1")).toBe(2);
    expect(passesCardHeight(rememberedPassCount("org-2"))).toBe(432);
  });

  it("keeps a member with no pass at the one-pass height, and forgets a garbled value", () => {
    rememberPassCount("org-1", 0);
    expect(rememberedPassCount("org-1")).toBe(0);
    expect(passesCardHeight(0)).toBe(188);
    window.localStorage.setItem("tempo.client-web.passes.org-1", "lots");
    expect(rememberedPassCount("org-1")).toBeNull();
  });
});

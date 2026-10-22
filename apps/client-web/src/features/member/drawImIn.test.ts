import { describe, expect, it } from "vitest";
import { recordingContext } from "../../test/canvas";
import { drawImIn, imInCells, shade, type ImInCardInput } from "./drawImIn";

const card: ImInCardInput = {
  className: "פילאטיס מכשירים",
  when: "שני 18:00",
  spotLabel: "4",
  instructor: "מאיה",
  studioName: "סטודיו נשימה",
  footnote: "נשארו 2 מקומות",
  handle: "neshima.studio",
  accent: "#56735b",
  photo: null,
};

describe("drawImIn", () => {
  it("draws the class, the time, the spot, the instructor, the studio and the tag", () => {
    const { ctx, texts } = recordingContext();
    drawImIn(ctx, card);
    expect(texts).toEqual([
      "אני בפנים",
      "מי מצטרפת?",
      "פילאטיס מכשירים",
      "מתי",
      "שני 18:00",
      "מכשיר",
      "מספר 4",
      "עם",
      "מאיה",
      "איפה",
      "סטודיו נשימה",
      "נשארו 2 מקומות",
      "@neshima.studio",
    ]);
  });

  it("leaves out an instructor without a public profile, a missing spot and a missing tag (M-14)", () => {
    const { ctx, texts } = recordingContext();
    drawImIn(ctx, { ...card, instructor: null, spotLabel: null, handle: null, footnote: null });
    expect(texts).not.toContain("עם");
    expect(texts).not.toContain("מכשיר");
    expect(texts.some((text) => text.startsWith("@"))).toBe(false);
    expect(texts).toContain("בואי איתי");
  });

  it("has no field for a member's name: the input carries none (C-1)", () => {
    const cells = imInCells(card).map((cell) => cell.label);
    expect(cells).toEqual(["מתי", "מכשיר", "עם", "איפה"]);
  });
});

describe("shade", () => {
  it("mixes toward black and white", () => {
    expect(shade("#56735b", 0)).toBe("#56735b");
    expect(shade("#56735b", -1)).toBe("#000000");
    expect(shade("#56735b", 1)).toBe("#ffffff");
    expect(shade("#808080", -0.5)).toBe("#404040");
  });
});

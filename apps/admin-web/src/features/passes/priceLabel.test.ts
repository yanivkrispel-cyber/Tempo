import { describe, expect, it } from "vitest";
import { priceLabel } from "./queries";

// The board #481 sweep (O4): a whole price carries no agorot, as on the member app and the today sales.
describe("priceLabel", () => {
  it("drops the agorot of a whole price and keeps them otherwise", () => {
    expect(priceLabel(60000)).toContain("600");
    expect(priceLabel(60000)).not.toContain(".");
    expect(priceLabel(0)).not.toContain(".");
    expect(priceLabel(4990)).toContain("49.90");
    expect(priceLabel(null)).toBe("—");
  });
});

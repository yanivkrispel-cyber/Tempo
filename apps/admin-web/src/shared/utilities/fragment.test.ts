import { describe, expect, it } from "vitest";
import { parseFragment } from "./fragment";

describe("parseFragment", () => {
  it("returns the value after #", () => {
    expect(parseFragment("#q1w2-e3_r4")).toBe("q1w2-e3_r4");
  });

  it.each(["", "#", "#   "])("returns null for an empty fragment %j", (hash) => {
    expect(parseFragment(hash)).toBeNull();
  });

  it("returns null for a malformed escape instead of throwing", () => {
    expect(parseFragment("#%E0%A4%A")).toBeNull();
  });
});

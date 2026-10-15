import { describe, expect, it } from "vitest";
import { displayPhone, looksLikePhone, phoneSearchText } from "./phones";

describe("displayPhone", () => {
  it.each([
    ["+972501234567", "050-123-4567"],
    ["+97231234567", "03-123-4567"],
    ["+97721234567", "+97721234567"],
    ["+14155550123", "+14155550123"]
  ])("%s -> %s", (input, expected) => {
    expect(displayPhone(input)).toBe(expected);
  });
});

describe("looksLikePhone", () => {
  it.each([
    ["050-1234567", true],
    ["+972 50 123 4567", true],
    ["0501234567", true],
    ["נועה", false],
    ["noa@example.com", false],
    ["12", false]
  ])("%s -> %s", (input, expected) => {
    expect(looksLikePhone(input)).toBe(expected);
  });
});

describe("phoneSearchText", () => {
  it.each([
    ["050-123", "+97250123"],
    ["+972 50 123", "+97250123"],
    ["  נועה ", "נועה"],
    ["noa@example", "noa@example"]
  ])("%s -> %s", (input, expected) => {
    expect(phoneSearchText(input)).toBe(expected);
  });
});

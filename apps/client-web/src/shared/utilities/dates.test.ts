import { describe, expect, it } from "vitest";
import { addDays, addMonths, endOfWeek, formatDate, fromIsoDate, monthWeeks, parseDate, startOfWeek } from "./dates";
import { matchTimes, parseTime, timeOptions } from "./times";

describe("dates", () => {
  it("rejects dates that do not exist", () => {
    expect(fromIsoDate("2026-02-29")).toBeNull();
    expect(fromIsoDate("2028-02-29")).not.toBeNull();
    expect(fromIsoDate("15.10.2026")).toBeNull();
  });

  it.each([
    ["15.10.2026", "2026-10-15"],
    ["15/10/26", "2026-10-15"],
    ["5-3-2026", "2026-03-05"],
    ["151026", "2026-10-15"],
    ["15102026", "2026-10-15"],
    ["15.10", "2026-10-15"],
    [" 2026-10-15 ", "2026-10-15"]
  ])("reads %j day first", (text, iso) => {
    expect(parseDate(text, "2026-06-01")).toBe(iso);
  });

  it.each(["", "32.10.2026", "29.2.2026", "10/15/2026", "15.10.202", "abc"])("refuses %j", (text) => {
    expect(parseDate(text, "2026-06-01")).toBeNull();
  });

  it("writes dates the Israeli way", () => {
    expect(formatDate("2026-03-05")).toBe("05.03.2026");
  });

  it("adds months without spilling into the next one", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-10-15", 12)).toBe("2027-10-15");
  });

  it("crosses month and year ends by days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("starts weeks on Sunday", () => {
    expect(startOfWeek("2026-10-15")).toBe("2026-10-11");
    expect(endOfWeek("2026-10-15")).toBe("2026-10-17");
  });

  it("lays a month out in whole Sunday-first weeks", () => {
    const october = monthWeeks("2026-10-15");
    expect(october).toHaveLength(5);
    expect(october[0]?.[0]).toBe("2026-09-27");
    expect(october[4]?.[6]).toBe("2026-10-31");

    const february = monthWeeks("2026-02-10");
    expect(february).toHaveLength(4);
    expect(february[0]?.[0]).toBe("2026-02-01");
  });
});

describe("times", () => {
  it.each([
    ["18:30", "18:30"],
    ["18.30", "18:30"],
    ["1830", "18:30"],
    ["930", "09:30"],
    ["9:05", "09:05"],
    ["18", "18:00"]
  ])("reads %j", (text, time) => {
    expect(parseTime(text)).toBe(time);
  });

  it.each(["", "24:00", "18:60", "18:3", "abc"])("refuses %j", (text) => {
    expect(parseTime(text)).toBeNull();
  });

  it("suggests times every step minutes, both ends included", () => {
    const times = timeOptions(30, "06:00", "08:00");
    expect(times).toEqual(["06:00", "06:30", "07:00", "07:30", "08:00"]);
  });

  it("filters suggestions by the digits typed so far", () => {
    const times = timeOptions(15, "08:00", "19:00");
    expect(matchTimes(times, "18")).toEqual(["18:00", "18:15", "18:30", "18:45"]);
    expect(matchTimes(times, "18:3")).toEqual(["18:30"]);
    expect(matchTimes(times, "9")).toEqual(["09:00", "09:15", "09:30", "09:45"]);
    expect(matchTimes(times, "")).toHaveLength(times.length);
  });
});

import { describe, expect, it } from "vitest";
import { deviceCountText } from "./bookingState";

const session = (capacity: number, bookedCount: number) =>
  ({ capacity, bookedCount }) as Parameters<typeof deviceCountText>[0];
const spots = (free: number, taken: number) => [
  ...Array.from({ length: free }, () => ({ state: "free" })),
  ...Array.from({ length: taken }, () => ({ state: "taken" })),
];

describe("deviceCountText (#503)", () => {
  it("counts the free devices out of the room's devices", () => {
    expect(deviceCountText(session(12, 4), spots(8, 4))).toBe("8 פנויים מתוך 12");
  });

  it("never offers more devices than the class has places", () => {
    // A room of 12 for a class of 8, full through desk bookings that took no device.
    expect(deviceCountText(session(8, 8), spots(12, 0))).toBe("0 פנויים מתוך 8");
    expect(deviceCountText(session(8, 6), spots(10, 2))).toBe("2 פנויים מתוך 8");
  });
});

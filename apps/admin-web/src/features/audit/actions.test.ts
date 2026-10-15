import { describe, expect, it } from "vitest";
import { actionLabel } from "./actions";

describe("audit action labels", () => {
  it("reads the scheduling and pass actions in Hebrew (#166)", () => {
    const actions = [
      "session.created",
      "session.cancelled",
      "session.message_sent",
      "booking.created",
      "booking.waitlisted",
      "booking.promoted",
      "booking.cancelled",
      "booking.moved",
      "booking.attendance_marked",
      "pass_product.created",
      "pass.granted",
      "pass.frozen",
      "template.created",
    ];
    for (const action of actions) expect(actionLabel(action), action).not.toBe(action);
    expect(actionLabel("booking.moved")).toBe("העברה לשיעור אחר");
  });

  it("shows an action it does not know as sent", () => {
    expect(actionLabel("something.new")).toBe("something.new");
  });
});

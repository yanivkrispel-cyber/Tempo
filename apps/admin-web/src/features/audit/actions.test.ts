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

  it("reads the actions of boards #253 to #471 in Hebrew, not as raw keys (board #481 sweep)", () => {
    const actions = [
      "account.created",
      "membership.joined_via_public_page",
      "people.imported",
      "person.tagged",
      "room.layout_updated",
      "booking.checked_in",
      "booking.spot_changed",
      "buddy.linked",
      "buddy.unlinked",
      "referral.rewarded",
      "media.uploaded",
      "public_page.updated",
      "template.changed",
      "push_subscription.created",
      "health.declaration.signed",
      "marketing.link.created",
      "person.note.added",
    ];
    for (const action of actions) expect(actionLabel(action), action).not.toBe(action);
    expect(actionLabel("booking.checked_in")).toBe("כניסה לשיעור");
  });

  it("shows an action it does not know as sent", () => {
    expect(actionLabel("something.new")).toBe("something.new");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SlideToConfirm } from "./Premium";

describe("slide to confirm", () => {
  it("brings the knob back when the booking fails, so the member can try again", async () => {
    const onConfirm = vi.fn();
    const props = { label: "החליקו כדי לשריין", actionLabel: "אישור ההרשמה", onConfirm };
    const { rerender } = render(<SlideToConfirm {...props} pending={false} />);
    const knob = screen.getByRole("button", { name: "אישור ההרשמה" });

    await userEvent.click(knob);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(knob.style.transform).not.toBe("translateX(0px)");

    rerender(<SlideToConfirm {...props} pending />);
    rerender(<SlideToConfirm {...props} pending={false} />);
    expect(knob.style.transform).toBe("translateX(0px)");

    await userEvent.click(knob);
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

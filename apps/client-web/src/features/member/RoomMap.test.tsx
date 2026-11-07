import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionSpots } from "./experience";
import { RoomMap } from "./RoomMap";

const room = (avatarUrl: string | null) =>
  ({
    cols: 1,
    windowSide: null,
    mirrorFront: false,
    usualSpotId: null,
    spots: [
      {
        id: "spot-1",
        label: "3",
        row: 0,
        col: 0,
        kind: "reformer",
        state: "buddy",
        person: { displayName: "מאיה כהן", avatarUrl },
      },
    ],
  }) as unknown as SessionSpots;

describe("a buddy's spot on the room map", () => {
  it("opens its name with the initials and the number it shows (#626)", () => {
    render(<RoomMap map={room(null)} selectedId={null} onSelect={vi.fn()} />);
    const spot = screen.getByRole("button", { name: "מכ 3, מכשיר 3, מאיה כהן כאן" });
    expect(spot).toBeDisabled();
    // axe reads the text with no separator of its own, so the space has to be in the button.
    expect(spot.textContent).toBe("מכ 3");
  });

  it("leaves the initials out when a picture shows instead", () => {
    render(<RoomMap map={room("https://example.com/maya.png")} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "מכשיר 3, מאיה כהן כאן" })).toBeDisabled();
  });
});

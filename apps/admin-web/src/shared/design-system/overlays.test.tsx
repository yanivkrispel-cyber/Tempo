import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Dialog, DropdownMenu, ToastProvider, useToast, type MenuEntry } from "./index";

describe("Dialog", () => {
  function CancelBooking({ dismissible = true, onClose = () => {} }: { dismissible?: boolean; onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>ביטול הרשמה</Button>
        <Dialog
          open={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          dismissible={dismissible}
          title="לבטל את ההרשמה?"
          description="המקום יעבור לממתינה הראשונה."
          actions={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                השארה
              </Button>
              <Button variant="danger">ביטול</Button>
            </>
          }
        />
      </>
    );
  }

  it("is a modal dialog named and described by its title and line, with focus inside", async () => {
    render(<CancelBooking />);
    await userEvent.click(screen.getByRole("button", { name: "ביטול הרשמה" }));

    const dialog = screen.getByRole("dialog", { name: "לבטל את ההרשמה?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("המקום יעבור לממתינה הראשונה.");
    expect(screen.getByRole("button", { name: "השארה" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("keeps Tab inside the dialog in both directions", async () => {
    render(<CancelBooking />);
    await userEvent.click(screen.getByRole("button", { name: "ביטול הרשמה" }));

    await userEvent.tab();
    expect(screen.getByRole("button", { name: "ביטול" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "השארה" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "ביטול" })).toHaveFocus();
  });

  it("closes on Escape and gives focus back to the opener", async () => {
    const onClose = vi.fn();
    render(<CancelBooking onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "ביטול הרשמה" });
    await userEvent.click(opener);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on a backdrop click but not on a click inside", async () => {
    const onClose = vi.fn();
    render(<CancelBooking onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "ביטול הרשמה" }));

    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores Escape and the backdrop when it must be answered", async () => {
    const onClose = vi.fn();
    render(<CancelBooking dismissible={false} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "ביטול הרשמה" }));

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function Book({ withUndo = false }: { withUndo?: boolean }) {
    const toast = useToast();
    return (
      <Button
        onClick={() =>
          toast.show({ message: "נרשמת לפילאטיס", tone: "success", action: withUndo ? { label: "ביטול", onClick: () => {} } : undefined })
        }
      >
        הרשמה
      </Button>
    );
  }

  it("shows the message in a polite live region and hides it after the duration", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider duration={4000}>
        <Book />
      </ToastProvider>
    );
    const region = screen.getByRole("region", { name: "הודעות" });
    expect(region).toHaveAttribute("aria-live", "polite");

    act(() => screen.getByRole("button", { name: "הרשמה" }).click());
    expect(region).toHaveTextContent("נרשמת לפילאטיס");
    expect(region.querySelector(".tp-toast")).toHaveClass("tp-toast--success");

    act(() => vi.advanceTimersByTime(3999));
    expect(region).toHaveTextContent("נרשמת לפילאטיס");
    act(() => vi.advanceTimersByTime(1));
    expect(region).not.toHaveTextContent("נרשמת לפילאטיס");
  });

  it("keeps a toast with an action until it is used or closed", async () => {
    render(
      <ToastProvider duration={10}>
        <Book withUndo />
      </ToastProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "הרשמה" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole("region")).toHaveTextContent("נרשמת לפילאטיס");

    await userEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.getByRole("region")).not.toHaveTextContent("נרשמת לפילאטיס");
  });

  it("explains a missing provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Book />)).toThrow("useToast needs a <ToastProvider> above it.");
  });
});

describe("DropdownMenu", () => {
  function RowMenu({ onEdit = () => {}, onDelete = () => {} }: { onEdit?: () => void; onDelete?: () => void }) {
    const items: MenuEntry[] = [
      { label: "עריכה", icon: "edit", onSelect: onEdit },
      { label: "שיתוף", icon: "share", onSelect: () => {}, disabled: true },
      { label: "העברה", onSelect: () => {} },
      "separator",
      { label: "מחיקה", onSelect: onDelete, danger: true }
    ];
    return (
      <div dir="rtl">
        <DropdownMenu label="פעולות לשיעור" icon="list" iconOnly items={items} />
        <button type="button">מחוץ לתפריט</button>
      </div>
    );
  }

  const trigger = () => screen.getByRole("button", { name: "פעולות לשיעור" });

  it("is a menu button that opens on the first item", async () => {
    render(<RowMenu />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "פעולות לשיעור" })).toHaveClass("tp-menu", "tp-menu--popover");
    expect(screen.getByRole("menuitem", { name: "עריכה" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "שיתוף" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "מחיקה" })).toHaveClass("tp-menu__item--danger");
  });

  it("moves with the arrows, skips disabled items, wraps, and jumps by first letter", async () => {
    render(<RowMenu />);
    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "עריכה" })).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "העברה" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "מחיקה" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "עריכה" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "מחיקה" })).toHaveFocus();
    await userEvent.keyboard("ע");
    expect(screen.getByRole("menuitem", { name: "עריכה" })).toHaveFocus();
  });

  it("opens on the last item with ArrowUp", async () => {
    render(<RowMenu />);
    trigger().focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "מחיקה" })).toHaveFocus();
  });

  it("runs the action, closes, and returns focus to the trigger", async () => {
    const onDelete = vi.fn();
    render(<RowMenu onDelete={onDelete} />);
    await userEvent.click(trigger());
    await userEvent.keyboard("{End}{Enter}");

    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("closes on Escape back to the trigger, and on a click outside", async () => {
    render(<RowMenu />);
    await userEvent.click(trigger());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("button", { name: "מחוץ לתפריט" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

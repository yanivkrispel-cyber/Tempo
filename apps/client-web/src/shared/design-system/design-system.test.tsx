import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  Avatar,
  Banner,
  Button,
  ButtonLink,
  Chip,
  CountBadge,
  Field,
  Icon,
  IconButton,
  Input,
  ProgressBar,
  ProgressRing,
  Segmented,
  Tabs,
  Textarea,
  Toggle
} from "./index";

describe("Button", () => {
  it("is a primary type=button by default, so it never submits a form by accident", () => {
    render(<Button>שמירה</Button>);
    const button = screen.getByRole("button", { name: "שמירה" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("tp-btn");
    expect(button.className).not.toMatch(/tp-btn--/);
  });

  it("maps variant, size and block to the design-system classes", () => {
    render(
      <Button variant="secondary" size="lg" block>
        ביטול
      </Button>
    );
    expect(screen.getByRole("button")).toHaveClass("tp-btn", "tp-btn--secondary", "tp-btn--lg", "tp-btn--block");
  });

  it("ignores clicks while loading but keeps its name and focus", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        הזמנה
      </Button>
    );
    const button = screen.getByRole("button", { name: "הזמנה" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("tp-btn--loading");
    expect(button).toBeEnabled();

    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls onClick when not loading", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>הזמנה</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("gives an icon-only button its accessible name from the label", () => {
    render(<IconButton icon="close" label="סגירה" size="sm" />);
    expect(screen.getByRole("button", { name: "סגירה" })).toHaveClass("tp-btn", "tp-btn--icon", "tp-btn--sm");
  });

  it("renders a navigation link that looks like a button", () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/" variant="ghost">
          לדף הבית
        </ButtonLink>
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "לדף הבית" });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveClass("tp-btn", "tp-btn--ghost");
  });
});

describe("Field", () => {
  it("wires the label, the hint and the required flag to the control", () => {
    render(
      <Field label="שם מלא" help="כפי שיופיע בסטודיו" required>
        <Input />
      </Field>
    );
    const input = screen.getByLabelText(/שם מלא/);
    expect(input).toBeRequired();
    expect(input).toHaveAccessibleDescription("כפי שיופיע בסטודיו");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("shows the error instead of the hint and marks the control invalid", () => {
    const { container } = render(
      <Field label="הערות" help="לא חובה" error="עד 500 תווים">
        <Textarea />
      </Field>
    );
    const textarea = screen.getByLabelText("הערות");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAccessibleDescription("עד 500 תווים");
    expect(screen.queryByText("לא חובה")).not.toBeInTheDocument();
    expect(container.firstChild).toHaveClass("tp-field", "tp-field--invalid");
  });

  it("leaves a control outside a Field alone", () => {
    render(<Input aria-label="חיפוש" search />);
    const input = screen.getByRole("textbox", { name: "חיפוש" });
    expect(input).toHaveClass("tp-input", "tp-input--search");
    expect(input).not.toHaveAttribute("id");
  });
});

describe("Toggle", () => {
  it("is a switch named by its label, even when the label is visually hidden", async () => {
    render(<Toggle label="תזכורת לפני שיעור" hideLabel />);
    const toggle = screen.getByRole("switch", { name: "תזכורת לפני שיעור" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
  });
});

describe("Segmented", () => {
  it("marks the current option as pressed and reports a new choice", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="תצוגה"
        value="week"
        onChange={onChange}
        options={[
          { value: "day", label: "יום" },
          { value: "week", label: "שבוע" }
        ]}
      />
    );
    expect(screen.getByRole("group", { name: "תצוגה" })).toHaveClass("tp-seg");
    expect(screen.getByRole("button", { name: "שבוע" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "יום" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "יום" }));
    expect(onChange).toHaveBeenCalledWith("day");
  });
});

describe("Tabs", () => {
  const tabs = [
    { value: "upcoming", label: "קרובים" },
    { value: "past", label: "היסטוריה" },
    { value: "waitlist", label: "המתנה" }
  ] as const;

  function BookingTabs({ dir }: { dir: "rtl" | "ltr" }) {
    const [value, setValue] = useState<(typeof tabs)[number]["value"]>("upcoming");
    return (
      <div dir={dir}>
        <Tabs label="ההזמנות שלי" tabs={tabs} value={value} onChange={setValue}>
          תוכן {value}
        </Tabs>
      </div>
    );
  }

  it("has one tab stop and a panel named by the selected tab", () => {
    render(<BookingTabs dir="rtl" />);
    expect(screen.getByRole("tablist", { name: "ההזמנות שלי" })).toHaveClass("tp-tabs");
    expect(screen.getByRole("tab", { name: "קרובים" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "היסטוריה" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel", { name: "קרובים" })).toHaveTextContent("תוכן upcoming");
  });

  it("moves forward with ArrowLeft in RTL, wraps, and supports Home and End", async () => {
    render(<BookingTabs dir="rtl" />);
    screen.getByRole("tab", { name: "קרובים" }).focus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "היסטוריה" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "היסטוריה" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "היסטוריה" })).toHaveTextContent("תוכן past");

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "המתנה" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "קרובים" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "המתנה" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "קרובים" })).toHaveFocus();
  });

  it("moves forward with ArrowRight in LTR", async () => {
    render(<BookingTabs dir="ltr" />);
    screen.getByRole("tab", { name: "קרובים" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "היסטוריה" })).toHaveFocus();
  });
});

describe("Progress", () => {
  it("fills the ring by value and exposes it as a progress bar", () => {
    render(
      <ProgressRing value={6} max={12} label="תפוסה" size="sm">
        6/12
      </ProgressRing>
    );
    const ring = screen.getByRole("progressbar", { name: "תפוסה" });
    expect(ring).toHaveAttribute("aria-valuenow", "6");
    expect(ring).toHaveAttribute("aria-valuemax", "12");
    expect(ring.style.getPropertyValue("--tp-ring-deg")).toBe("180deg");
    expect(ring).toHaveClass("tp-ring", "tp-ring--sm");
    expect(ring).not.toHaveClass("tp-ring--over");
  });

  it("turns amber over the maximum and never overfills", () => {
    render(<ProgressRing value={14} max={12} label="תפוסה" />);
    const ring = screen.getByRole("progressbar");
    expect(ring).toHaveClass("tp-ring--over");
    expect(ring.style.getPropertyValue("--tp-ring-deg")).toBe("360deg");
  });

  it("sets the bar width as a percentage", () => {
    render(<ProgressBar value={3} max={10} label="ניצול המנוי" tone="sage" />);
    const bar = screen.getByRole("progressbar", { name: "ניצול המנוי" });
    expect(bar.style.getPropertyValue("--tp-bar")).toBe("30%");
    expect(bar).toHaveClass("tp-bar", "tp-bar--sage");
  });
});

describe("Display", () => {
  it("announces a danger banner as an alert and the others as status", () => {
    render(
      <>
        <Banner tone="danger">הקישור לא תקין</Banner>
        <Banner tone="info" icon="info">
          השיעור מתחיל בעוד שעה
        </Banner>
      </>
    );
    expect(screen.getByRole("alert")).toHaveClass("tp-banner", "tp-banner--danger");
    expect(screen.getByRole("status")).toHaveTextContent("השיעור מתחיל בעוד שעה");
  });

  it("shows initials and names the avatar after the person", () => {
    render(<Avatar name="נגה לוי" size="lg" />);
    expect(screen.getByRole("img", { name: "נגה לוי" })).toHaveTextContent("נל");
  });

  it("maps chip tones and names a count badge by what it counts", () => {
    render(
      <>
        <Chip tone="cat-rose">יוגה</Chip>
        <CountBadge count={3} label="3 הודעות חדשות" />
      </>
    );
    expect(screen.getByText("יוגה")).toHaveClass("tp-chip", "tp-chip--cat-rose");
    expect(screen.getByRole("img", { name: "3 הודעות חדשות" })).toHaveTextContent("3");
  });

  it("hides a decorative icon and names a meaningful one", () => {
    const { container } = render(
      <>
        <Icon name="bell" />
        <Icon name="check" label="הושלם" />
      </>
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("img", { name: "הושלם" })).toHaveClass("tp-icon");
  });
});

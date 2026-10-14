import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { IsoDate } from "../utilities/dates";
import type { Time } from "../utilities/times";
import { DateInput, Field, TimeInput } from "./index";

describe("DateInput", () => {
  function ClassDate({ initial = null, min, onChange = () => {} }: { initial?: IsoDate | null; min?: IsoDate; onChange?: (value: IsoDate | null) => void }) {
    const [value, setValue] = useState<IsoDate | null>(initial);
    return (
      <div dir="rtl">
        <Field label="תאריך">
          <DateInput
            value={value}
            min={min}
            today="2026-10-15"
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
          />
        </Field>
        <button type="button">הבא</button>
      </div>
    );
  }

  it("reads a typed date on blur and writes it back the Israeli way", async () => {
    const onChange = vi.fn();
    render(<ClassDate onChange={onChange} />);
    const input = screen.getByLabelText("תאריך");

    await userEvent.type(input, "15/10/26");
    await userEvent.tab();

    expect(onChange).toHaveBeenLastCalledWith("2026-10-15");
    expect(input).toHaveValue("15.10.2026");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("marks text that is not a date invalid, keeps it, and reports null", async () => {
    const onChange = vi.fn();
    render(<ClassDate initial="2026-10-15" onChange={onChange} />);
    const input = screen.getByLabelText("תאריך");

    await userEvent.clear(input);
    await userEvent.type(input, "32.10.2026");
    await userEvent.tab();

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue("32.10.2026");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("opens a calendar on the chosen day, with today marked", async () => {
    render(<ClassDate initial="2026-10-20" />);
    await userEvent.click(screen.getByRole("button", { name: /בחירת תאריך/ }));

    const grid = screen.getByRole("grid", { name: "אוקטובר 2026" });
    const chosen = within(grid).getByRole("gridcell", { name: "יום שלישי, 20 באוקטובר 2026" });
    expect(chosen).toHaveFocus();
    expect(chosen).toHaveAttribute("aria-selected", "true");
    expect(within(grid).getByRole("gridcell", { name: /15 באוקטובר/ })).toHaveAttribute("aria-current", "date");
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(7);
  });

  it("moves by day with ArrowLeft in RTL, by month with PageDown, and picks with Enter", async () => {
    const onChange = vi.fn();
    render(<ClassDate initial="2026-10-31" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /בחירת תאריך/ }));

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("gridcell", { name: "יום ראשון, 1 בנובמבר 2026" })).toHaveFocus();
    expect(screen.getByRole("grid", { name: "נובמבר 2026" })).toBeInTheDocument();

    await userEvent.keyboard("{PageDown}");
    expect(screen.getByRole("gridcell", { name: "יום שלישי, 1 בדצמבר 2026" })).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("2026-12-01");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.getByLabelText("תאריך")).toHaveValue("01.12.2026");
    expect(screen.getByLabelText("תאריך")).toHaveFocus();
  });

  it("closes on Escape back to the calendar button", async () => {
    render(<ClassDate />);
    const toggle = screen.getByRole("button", { name: "בחירת תאריך" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("does not offer days before min", async () => {
    const onChange = vi.fn();
    render(<ClassDate min="2026-10-15" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "בחירת תאריך" }));

    expect(screen.getByRole("gridcell", { name: /14 באוקטובר/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "החודש הקודם" })).toBeDisabled();

    await userEvent.click(screen.getByRole("gridcell", { name: /14 באוקטובר/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("gridcell", { name: /15 באוקטובר/ })).toHaveFocus();

    // ArrowRight goes back a day in RTL, and stops at min.
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("gridcell", { name: /15 באוקטובר/ })).toHaveFocus();
  });

  it("reads a two-digit year in the century that fits max, as for a birth date", async () => {
    const onChange = vi.fn();
    render(
      <Field label="תאריך לידה">
        <DateInput value={null} max="2026-10-15" today="2026-10-15" onChange={onChange} />
      </Field>
    );
    await userEvent.type(screen.getByLabelText("תאריך לידה"), "15.10.30");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith("1930-10-15");
  });

  it("refuses a typed date outside the range", async () => {
    render(<ClassDate min="2026-10-15" />);
    const input = screen.getByLabelText("תאריך");
    await userEvent.type(input, "14.10.2026");
    await userEvent.tab();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});

describe("TimeInput", () => {
  function StartTime({ initial = null, onChange = () => {} }: { initial?: Time | null; onChange?: (value: Time | null) => void }) {
    const [value, setValue] = useState<Time | null>(initial);
    return (
      <>
        <Field label="שעת התחלה">
          <TimeInput
            value={value}
            step={30}
            from="06:00"
            to="21:00"
            onChange={(next) => {
              onChange(next);
              setValue(next);
            }}
          />
        </Field>
        <button type="button">הבא</button>
      </>
    );
  }

  it("is a combobox that opens its list on ArrowDown at the current time", async () => {
    render(<StartTime initial="18:00" />);
    const input = screen.getByRole("combobox", { name: "שעת התחלה" });
    expect(input).toHaveAttribute("aria-expanded", "false");

    input.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const active = screen.getByRole("option", { name: "18:00" });
    expect(input).toHaveAttribute("aria-activedescendant", active.id);
    expect(active).toHaveAttribute("aria-selected", "true");
  });

  it("picks the highlighted time with Enter", async () => {
    const onChange = vi.fn();
    render(<StartTime initial="18:00" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    input.focus();

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("18:30");
    expect(input).toHaveValue("18:30");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("filters as you type and picks with a click", async () => {
    const onChange = vi.fn();
    render(<StartTime onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "7");

    const list = screen.getByRole("listbox", { name: "שעות" });
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual(["07:00", "07:30"]);

    await userEvent.click(within(list).getByRole("option", { name: "07:30" }));
    expect(onChange).toHaveBeenLastCalledWith("07:30");
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("accepts any typed time, off the list too", async () => {
    const onChange = vi.fn();
    render(<StartTime onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "1845");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith("18:45");
    expect(screen.getByRole("combobox")).toHaveValue("18:45");
  });

  it("marks text that is not a time invalid", async () => {
    const onChange = vi.fn();
    render(<StartTime onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "25:00");
    await userEvent.tab();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalledWith(expect.stringMatching(/./));
  });
});

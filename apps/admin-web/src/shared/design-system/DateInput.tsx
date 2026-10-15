import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import {
  addDays,
  addMonths,
  clampDate,
  endOfWeek,
  formatDate,
  fromIsoDate,
  inRange,
  monthWeeks,
  parseDate,
  sameMonth,
  startOfMonth,
  startOfWeek,
  todayIso,
  type IsoDate,
} from "../utilities/dates";
import { cx } from "./cx";
import { isRtl } from "./direction";
import { useFieldControl } from "./Field";
import { Icon } from "./Icon";

const monthTitle = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });
const fullDate = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const weekdayNarrow = new Intl.DateTimeFormat("he-IL", { weekday: "narrow" });
const weekdayLong = new Intl.DateTimeFormat("he-IL", { weekday: "long" });

const asDate = (iso: IsoDate) => fromIsoDate(iso) ?? new Date(Number.NaN);

export interface DateInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "min" | "max" | "type"
> {
  value: IsoDate | null;
  onChange: (value: IsoDate | null) => void;
  min?: IsoDate;
  max?: IsoDate;
  /** The device's date by default; tests pass a fixed one. */
  today?: IsoDate;
}

/**
 * A date typed day first ("15.10.2026", "15/10/26", "151026") or picked from a month calendar.
 * The value is an ISO date or null; text that is not a date (or is outside min/max) marks the
 * input invalid and reports null. The calendar follows the WAI-ARIA date picker grid.
 */
export function DateInput({
  value,
  onChange,
  min,
  max,
  today = todayIso(),
  className,
  onBlur,
  onKeyDown,
  ...rest
}: DateInputProps) {
  const control = useFieldControl(rest);
  const [text, setText] = useState(value ? formatDate(value) : "");
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(value);
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // A new value from outside replaces the text; values this input reports itself are already shown.
  if (value !== shown) {
    setShown(value);
    setText(value ? formatDate(value) : "");
    setInvalid(false);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function report(next: IsoDate | null) {
    setShown(next);
    if (next !== value) onChange(next);
  }

  function commitText() {
    if (text.trim() === "") {
      setInvalid(false);
      report(null);
      return;
    }
    const parsed = parseDate(text, today, { min, max });
    if (parsed && inRange(parsed, min, max)) {
      setInvalid(false);
      setText(formatDate(parsed));
      report(parsed);
    } else {
      setInvalid(true);
      report(null);
    }
  }

  function pick(iso: IsoDate) {
    setText(formatDate(iso));
    setInvalid(false);
    report(iso);
    setOpen(false);
    input.current?.focus();
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape bubbles up from the input and the calendar popover; the wrapper is not a control.
    <div
      ref={anchor}
      className="tp-field__control tp-field__control--adorned"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <input
        ref={input}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="יום.חודש.שנה"
        className={cx("tp-input", className)}
        {...control}
        aria-invalid={invalid || control["aria-invalid"] || undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onBlur={(event) => {
          commitText();
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitText();
          if (event.key === "ArrowDown" && event.altKey) {
            event.preventDefault();
            setOpen(true);
          }
          onKeyDown?.(event);
        }}
      />
      <button
        ref={toggle}
        type="button"
        className="tp-btn tp-btn--icon tp-btn--sm tp-field__adorn"
        aria-label={value ? `בחירת תאריך, נבחר ${fullDate.format(asDate(value))}` : "בחירת תאריך"}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={control.disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="calendar" />
      </button>
      {open && <Calendar value={value} min={min} max={max} today={today} onSelect={pick} />}
    </div>
  );
}

interface CalendarProps {
  value: IsoDate | null;
  min?: IsoDate;
  max?: IsoDate;
  today: IsoDate;
  onSelect: (iso: IsoDate) => void;
}

function Calendar({ value, min, max, today, onSelect }: CalendarProps) {
  const [focused, setFocused] = useState(() => clampDate(value ?? today, min, max));
  const focusDay = useRef(true);
  const grid = useRef<HTMLTableElement>(null);
  const titleId = useId();
  const weeks = monthWeeks(focused);

  useEffect(() => {
    if (focusDay.current) grid.current?.querySelector<HTMLElement>(`[data-date="${focused}"]`)?.focus();
  }, [focused]);

  // Keyboard moves focus with the day; the month buttons keep it on themselves.
  function go(next: IsoDate, withFocus: boolean) {
    const target = clampDate(next, min, max);
    focusDay.current = withFocus;
    if (target === focused && withFocus) grid.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus();
    setFocused(target);
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const forward = isRtl(event.currentTarget) ? "ArrowLeft" : "ArrowRight";
    const back = forward === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    const next =
      event.key === forward
        ? addDays(focused, 1)
        : event.key === back
          ? addDays(focused, -1)
          : event.key === "ArrowDown"
            ? addDays(focused, 7)
            : event.key === "ArrowUp"
              ? addDays(focused, -7)
              : event.key === "Home"
                ? startOfWeek(focused)
                : event.key === "End"
                  ? endOfWeek(focused)
                  : event.key === "PageDown"
                    ? addMonths(focused, event.shiftKey ? 12 : 1)
                    : event.key === "PageUp"
                      ? addMonths(focused, event.shiftKey ? -12 : -1)
                      : undefined;

    if (next !== undefined) {
      event.preventDefault();
      go(next, true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (inRange(focused, min, max)) onSelect(focused);
    }
  }

  const firstOfMonth = startOfMonth(focused);
  const nextMonth = startOfMonth(addMonths(firstOfMonth, 1));
  return (
    <div role="dialog" aria-labelledby={titleId} className="tp-calendar tp-popover">
      <div className="tp-calendar__head">
        <button
          type="button"
          className="tp-btn tp-btn--icon tp-btn--sm"
          aria-label="החודש הקודם"
          disabled={min !== undefined && addDays(firstOfMonth, -1) < min}
          onClick={() => go(addMonths(focused, -1), false)}
        >
          <Icon name="chevron-right" />
        </button>
        <h2 id={titleId} className="tp-calendar__title" aria-live="polite">
          {monthTitle.format(asDate(focused))}
        </h2>
        <button
          type="button"
          className="tp-btn tp-btn--icon tp-btn--sm"
          aria-label="החודש הבא"
          disabled={max !== undefined && nextMonth > max}
          onClick={() => go(addMonths(focused, 1), false)}
        >
          <Icon name="chevron-left" />
        </button>
      </div>
      <table ref={grid} role="grid" aria-labelledby={titleId} className="tp-calendar__grid" onKeyDown={onGridKeyDown}>
        <thead>
          <tr>
            {(weeks[0] ?? []).map((day) => (
              <th key={day} scope="col" abbr={weekdayLong.format(asDate(day))}>
                {weekdayNarrow.format(asDate(day))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const disabled = !inRange(day, min, max);
                return (
                  <td
                    key={day}
                    data-date={day}
                    role="gridcell"
                    tabIndex={day === focused ? 0 : -1}
                    aria-label={fullDate.format(asDate(day))}
                    aria-selected={day === value}
                    aria-current={day === today ? "date" : undefined}
                    aria-disabled={disabled || undefined}
                    className={cx("tp-calendar__day", !sameMonth(day, focused) && "tp-calendar__day--outside")}
                    // A day outside min/max takes neither the click nor the focus.
                    onMouseDown={(event) => {
                      if (disabled) event.preventDefault();
                    }}
                    onClick={() => {
                      if (!disabled) onSelect(day);
                    }}
                  >
                    {Number(day.slice(8, 10))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

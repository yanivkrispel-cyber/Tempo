import { useEffect, useId, useMemo, useState, type InputHTMLAttributes } from "react";
import { matchTimes, parseTime, timeOptions, type Time } from "../utilities/times";
import { cx } from "./cx";
import { useFieldControl } from "./Field";

export interface TimeInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "step" | "min" | "max"> {
  value: Time | null;
  onChange: (value: Time | null) => void;
  /** Minutes between the suggested times. */
  step?: number;
  /** The first and last suggested times. Any valid time can still be typed. */
  from?: Time;
  to?: Time;
}

/**
 * A time typed ("18:30", "1830", "930") or picked from suggestions every `step` minutes: the
 * WAI-ARIA combobox with a list that filters as you type. Text that is not a time marks the input
 * invalid and reports null.
 */
export function TimeInput({ value, onChange, step = 15, from = "05:00", to = "23:00", className, onBlur, onKeyDown, ...rest }: TimeInputProps) {
  const control = useFieldControl(rest);
  const listId = useId();
  const [text, setText] = useState(value ?? "");
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(value);
  const all = useMemo(() => timeOptions(step, from, to), [step, from, to]);
  const options = useMemo(() => matchTimes(all, typed), [all, typed]);
  const optionId = (index: number) => `${listId}-${index}`;

  if (value !== shown) {
    setShown(value);
    setText(value ?? "");
    setInvalid(false);
  }

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, listId]);

  function report(next: Time | null) {
    setShown(next);
    if (next !== value) onChange(next);
  }

  function choose(time: Time) {
    setText(time);
    setInvalid(false);
    setOpen(false);
    setTyped("");
    report(time);
  }

  function commitText() {
    setOpen(false);
    setTyped("");
    if (text.trim() === "") {
      setInvalid(false);
      report(null);
      return;
    }
    const parsed = parseTime(text);
    if (parsed) choose(parsed);
    else {
      setInvalid(true);
      report(null);
    }
  }

  function openList() {
    const list = matchTimes(all, typed);
    const current = value ? list.findIndex((time) => time >= value) : 0;
    setActive(current === -1 ? list.length - 1 : current);
    setOpen(true);
  }

  return (
    <div className="tp-field__control">
      <input
        type="text"
        role="combobox"
        inputMode="numeric"
        autoComplete="off"
        placeholder="00:00"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        className={cx("tp-input", className)}
        {...control}
        aria-invalid={invalid || control["aria-invalid"] || undefined}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setTyped(event.target.value);
          setInvalid(false);
          setActive(matchTimes(all, event.target.value).length > 0 ? 0 : -1);
          setOpen(true);
        }}
        onBlur={(event) => {
          commitText();
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) openList();
            else setActive((index) => Math.min(index + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (open) setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            const option = open ? options[active] : undefined;
            if (open) event.preventDefault();
            if (option) choose(option);
            else commitText();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
          onKeyDown?.(event);
        }}
      />
      <ul id={listId} role="listbox" aria-label="שעות" className="tp-menu tp-listbox tp-popover" hidden={!open || options.length === 0}>
        {options.map((time, index) => (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the input owns the keyboard (combobox with aria-activedescendant); the option click is for pointer users.
          <li
            key={time}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            aria-current={time === value ? "true" : undefined}
            className="tp-menu__item"
            // Keep focus in the input: the click picks the time, the input's blur must not run first.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(time)}
          >
            {time}
          </li>
        ))}
      </ul>
    </div>
  );
}

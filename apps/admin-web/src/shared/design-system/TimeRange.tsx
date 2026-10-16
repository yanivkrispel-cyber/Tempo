import type { Time } from "../utilities/times";
import { cx } from "./cx";
import { Field } from "./Field";
import { TimeInput } from "./TimeInput";

export interface TimeWindow {
  startsLocal: Time;
  endsLocal: Time;
}

export interface TimeRangeProps {
  value: TimeWindow;
  onChange: (value: TimeWindow) => void;
  /** The group's accessible name, e.g. "שעות שקטות". */
  label: string;
  disabled?: boolean;
  /** Minutes between the suggested times, and the first and last suggestions. */
  step?: number;
  from?: Time;
  to?: Time;
  className?: string;
}

/** True when the window has a length; a window may cross midnight (22:00 to 07:00). */
export const isTimeWindowValid = (value: TimeWindow) => value.startsLocal !== value.endsLocal;

/**
 * A from-to pair of times (quiet hours): "מ־" and "עד" side by side, an empty end is ignored until it is a time,
 * and the same start and end is refused at the end field.
 */
export function TimeRange({
  value,
  onChange,
  label,
  disabled,
  step = 30,
  from = "00:00",
  to = "23:30",
  className,
}: TimeRangeProps) {
  return (
    <div role="group" aria-label={label} className={cx("tp-time-range", className)}>
      <Field label="מ־">
        <TimeInput
          value={value.startsLocal}
          from={from}
          to={to}
          step={step}
          disabled={disabled}
          onChange={(time) => time && onChange({ ...value, startsLocal: time })}
        />
      </Field>
      <Field label="עד" error={isTimeWindowValid(value) ? undefined : "שעת הסיום צריכה להיות שונה משעת ההתחלה."}>
        <TimeInput
          value={value.endsLocal}
          from={from}
          to={to}
          step={step}
          disabled={disabled}
          onChange={(time) => time && onChange({ ...value, endsLocal: time })}
        />
      </Field>
    </div>
  );
}

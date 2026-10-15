import type { ReactNode } from "react";
import { cx } from "./cx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name, e.g. "תצוגה". */
  label: string;
  /** Full width, the options sharing it equally. */
  block?: boolean;
  className?: string;
}

/** A few mutually exclusive options that filter or switch a view in place. */
export function Segmented<T extends string>({ options, value, onChange, label, block = false, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx("tp-seg", block && "tp-seg--block", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="tp-seg__opt"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

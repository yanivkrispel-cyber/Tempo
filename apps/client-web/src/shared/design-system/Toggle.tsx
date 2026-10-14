import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  /** Keeps the label for screen readers only, when the row around it already says what it is. */
  hideLabel?: boolean;
};

/** An on/off switch that applies at once (role="switch"). For a choice saved with a form, use Checkbox. */
export function Toggle({ label, hideLabel = false, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx("tp-toggle", className)}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="tp-toggle__track" aria-hidden="true" />
      <span className={hideLabel ? "tp-sr-only" : "tp-toggle__label"}>{label}</span>
    </label>
  );
}

export function Checkbox({ label, hideLabel = false, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx("tp-check", className)}>
      <input type="checkbox" {...rest} />
      <span className={hideLabel ? "tp-sr-only" : undefined}>{label}</span>
    </label>
  );
}

export function Radio({ label, hideLabel = false, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx("tp-check", className)}>
      <input type="radio" {...rest} />
      <span className={hideLabel ? "tp-sr-only" : undefined}>{label}</span>
    </label>
  );
}

import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ChipTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "brand"
  | "cat-sage"
  | "cat-rose"
  | "cat-taupe"
  | "cat-blue"
  | "cat-amber"
  | "cat-mauve";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  /** Without the colored dot. */
  plain?: boolean;
  sunken?: boolean;
  /** Required: status is never hue alone, so every chip carries a word. */
  children: ReactNode;
}

export function Chip({ tone = "neutral", plain = false, sunken = false, className, ...rest }: ChipProps) {
  return (
    <span
      className={cx(
        "tp-chip",
        tone !== "neutral" && `tp-chip--${tone}`,
        plain && "tp-chip--plain",
        sunken && "tp-chip--sunken",
        className,
      )}
      {...rest}
    />
  );
}

export interface CountBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  count: number;
  /** What is counted, read instead of the bare number, e.g. "3 הודעות חדשות". */
  label: string;
}

export function CountBadge({ count, label, className, ...rest }: CountBadgeProps) {
  return (
    <span className={cx("tp-chip", "tp-chip--count", className)} role="img" aria-label={label} {...rest}>
      {count}
    </span>
  );
}

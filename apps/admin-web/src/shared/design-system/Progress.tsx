import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

function fraction(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(Math.max(value / max, 0), 1);
}

export interface ProgressRingProps {
  value: number;
  max?: number;
  /** What the ring measures, e.g. "תפוסה". */
  label: string;
  size?: "sm" | "md" | "lg";
  tone?: "brand" | "rose";
  /** Shown in the middle, e.g. "8/12". */
  children?: ReactNode;
  className?: string;
}

/** A conic ring. Over the maximum (an overbooked class) it turns amber. */
export function ProgressRing({
  value,
  max = 100,
  label,
  size = "md",
  tone = "brand",
  children,
  className,
}: ProgressRingProps) {
  const style = { "--tp-ring-deg": `${fraction(value, max) * 360}deg` } as CSSProperties;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx(
        "tp-ring",
        size !== "md" && `tp-ring--${size}`,
        tone === "rose" && "tp-ring--rose",
        value > max && "tp-ring--over",
        className,
      )}
      style={style}
    >
      <span className="tp-ring__inner">{children}</span>
    </div>
  );
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  label: string;
  /** sand reads on a taupe base card. */
  tone?: "rose" | "sage" | "sand";
  className?: string;
}

export function ProgressBar({ value, max = 100, label, tone = "rose", className }: ProgressBarProps) {
  const style = { "--tp-bar": `${fraction(value, max) * 100}%` } as CSSProperties;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx("tp-bar", tone !== "rose" && `tp-bar--${tone}`, className)}
      style={style}
    >
      <div className="tp-bar__fill" />
    </div>
  );
}

import type { ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "rose" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width. */
  block?: boolean;
  icon?: IconName;
}

function buttonClass({ variant = "primary", size = "md", block = false }: ButtonLook, ...more: Array<string | false | undefined>) {
  return cx("tp-btn", variant !== "primary" && `tp-btn--${variant}`, size !== "md" && `tp-btn--${size}`, block && "tp-btn--block", ...more);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonLook {
  /** Shows the spinner and ignores clicks, but keeps focus and the label for screen readers. */
  loading?: boolean;
}

export function Button({ variant, size, block, icon, loading = false, type = "button", className, onClick, children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block }, loading && "tp-btn--loading", className)}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {icon && !loading && <Icon name={icon} />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: an icon-only button needs an accessible name. */
  label: string;
  size?: ButtonSize;
  /** Sage instead of the default cream tile. */
  primary?: boolean;
}

export function IconButton({ icon, label, size = "md", primary = false, type = "button", className, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx("tp-btn", "tp-btn--icon", size !== "md" && `tp-btn--${size}`, primary && "tp-btn--primary", className)}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export interface ButtonLinkProps extends LinkProps, ButtonLook {}

/** A link that looks like a button: for navigation, never for actions. */
export function ButtonLink({ variant, size, block, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClass({ variant, size, block }, className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

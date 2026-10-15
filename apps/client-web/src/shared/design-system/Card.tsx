import type { HTMLAttributes } from "react";
import { Link } from "react-router";
import { cx } from "./cx";

/**
 * sand: the raised default. cream: a lighter slab. base: taupe with white text.
 * elevated: rose, at most one per screen. sunken: a well.
 */
export type CardTone = "sand" | "cream" | "base" | "elevated" | "sunken";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  small?: boolean;
  selected?: boolean;
  as?: "div" | "section" | "article" | "li";
  /** Makes the whole card a link (like EventCard); `as` is then ignored. */
  to?: string;
}

export function Card({
  tone = "sand",
  small = false,
  selected = false,
  as: Tag = "div",
  to,
  className,
  ...rest
}: CardProps) {
  const classes = cx(
    "tp-card",
    tone !== "sand" && `tp-card--${tone}`,
    small && "tp-card--sm",
    selected && "tp-card--selected",
    className,
  );
  return to ? (
    <Link to={to} className={classes} {...(rest as HTMLAttributes<HTMLAnchorElement>)} />
  ) : (
    <Tag className={classes} {...rest} />
  );
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: "h2" | "h3" | "h4";
}

export function CardTitle({ as: Tag = "h2", className, ...rest }: CardTitleProps) {
  return <Tag className={cx("tp-card__title", className)} {...rest} />;
}

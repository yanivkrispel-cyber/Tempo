import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type BannerTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  tone?: BannerTone;
  icon?: IconName;
}

/** A danger banner interrupts (role="alert"); the others are announced politely (role="status"). */
export function Banner({ tone = "neutral", icon, className, children, ...rest }: BannerProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("tp-banner", tone !== "neutral" && `tp-banner--${tone}`, className)}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      <div>{children}</div>
    </div>
  );
}

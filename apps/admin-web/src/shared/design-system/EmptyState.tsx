import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  title: ReactNode;
  titleAs?: "h1" | "h2" | "h3" | "p";
  icon?: IconName;
  /** One more line under the title. */
  children?: ReactNode;
  /** A button or link that leads out of the empty state. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, titleAs: Title = "p", icon, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx("tp-empty", className)}>
      {icon && <Icon name={icon} />}
      <Title className="tp-empty__title">{title}</Title>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

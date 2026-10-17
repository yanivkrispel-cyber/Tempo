import type { ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Icon } from "./Icon";

export interface LinkRowItem {
  key: string;
  /** The row's name, such as a person's name. */
  title: string;
  /** One short line under the name. */
  meta?: ReactNode;
  /** A short fact at the end of the row, such as "נשארה כניסה אחת". */
  aside?: ReactNode;
  /** Where the row leads; a row without it is plain text. */
  to?: string;
}

export interface LinkRowsProps {
  /** Names the list for a screen reader. */
  label: string;
  items: LinkRowItem[];
  className?: string;
}

/** A compact report list (docs/32 R-4): one line per row, the whole row a link with a 44px target. */
export function LinkRows({ label, items, className }: LinkRowsProps) {
  return (
    <ul className={cx("tp-rows", className)} aria-label={label}>
      {items.map((item) => {
        const body = (
          <>
            <span className="tp-row__main">
              <span className="tp-row__title">{item.title}</span>
              {item.meta && <span className="tp-row__meta">{item.meta}</span>}
            </span>
            {item.aside && <span className="tp-row__aside">{item.aside}</span>}
          </>
        );
        return (
          <li key={item.key}>
            {item.to ? (
              <Link className="tp-row" to={item.to}>
                {body}
                <Icon name="chevron-left" />
              </Link>
            ) : (
              <div className="tp-row">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

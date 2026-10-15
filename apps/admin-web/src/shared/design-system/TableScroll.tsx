import type { ReactNode } from "react";

/**
 * The scrolling frame of a wide table (`tp-table-wrap`). It is a named region that takes focus, so a keyboard can
 * scroll it on a phone (WCAG 2.1.1, axe `scrollable-region-focusable`); `label` is the table's caption.
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region must be reachable by keyboard.
    <div className="tp-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { isRtl } from "./direction";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

export interface TabsProps<T extends string> {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The tab list's accessible name, e.g. "ההזמנות שלי". */
  label: string;
  /** Full width, the tabs sharing it equally. */
  block?: boolean;
  className?: string;
  /** The selected tab's panel. */
  children?: ReactNode;
}

/** WAI-ARIA tabs with automatic activation: arrows, Home and End move and select. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  block = false,
  className,
  children,
}: TabsProps<T>) {
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(
    tabs.findIndex((tab) => tab.value === value),
    0,
  );
  const tabId = (index: number) => `${id}-tab-${index}`;
  const panelId = `${id}-panel`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = isRtl(event.currentTarget) ? "ArrowLeft" : "ArrowRight";
    const back = forward === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
    const last = tabs.length - 1;
    const target =
      event.key === forward
        ? selected === last
          ? 0
          : selected + 1
        : event.key === back
          ? selected === 0
            ? last
            : selected - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    const tab = target === undefined ? undefined : tabs[target];
    if (target === undefined || !tab) return;
    event.preventDefault();
    onChange(tab.value);
    buttons.current[target]?.focus();
  }

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- roving tabindex on the tabs (WAI-ARIA tabs pattern); the tablist is not a tab stop. */}
      <div
        role="tablist"
        aria-label={label}
        className={cx("tp-tabs", block && "tp-tabs--block", className)}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabId(index)}
            className="tp-tab"
            aria-selected={index === selected}
            aria-controls={index === selected ? panelId : undefined}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(selected)} tabIndex={0}>
          {children}
        </div>
      )}
    </>
  );
}

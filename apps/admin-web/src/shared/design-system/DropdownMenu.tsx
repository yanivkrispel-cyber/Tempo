import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";
import type { ButtonSize, ButtonVariant } from "./Button";

export interface MenuAction {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  disabled?: boolean;
  /** A destructive action, in danger ink. */
  danger?: boolean;
}

export type MenuEntry = MenuAction | "separator";

export interface DropdownMenuProps {
  /** The trigger's text, or its accessible name when `iconOnly`. */
  label: string;
  items: readonly MenuEntry[];
  icon?: IconName;
  /** Only the icon shows, e.g. a row's "more" button. */
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Extra content after the label in the trigger. */
  children?: ReactNode;
}

/**
 * The WAI-ARIA menu button: Enter, Space or ArrowDown open it on the first item, ArrowUp on the
 * last; arrows, Home, End and a first letter move; Escape closes and returns to the trigger; Tab
 * and a click outside close it.
 */
export function DropdownMenu({ label, items, icon, iconOnly = false, variant = "secondary", size = "md", className, children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerId = useId();
  const menuId = useId();

  const actions = items.filter((item): item is MenuAction => item !== "separator");
  const enabled = actions.flatMap((item, index) => (item.disabled ? [] : [index]));

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function openAt(index: number | undefined) {
    if (index === undefined) return;
    setActive(index);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAt(enabled[0]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(enabled[enabled.length - 1]);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const position = enabled.indexOf(active);
    const move = (to: number | undefined) => {
      if (to === undefined) return;
      event.preventDefault();
      setActive(to);
    };
    if (event.key === "ArrowDown") move(enabled[(position + 1) % enabled.length]);
    else if (event.key === "ArrowUp") move(enabled[(position - 1 + enabled.length) % enabled.length]);
    else if (event.key === "Home") move(enabled[0]);
    else if (event.key === "End") move(enabled[enabled.length - 1]);
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") setOpen(false);
    else if (event.key.length === 1 && event.key !== " ") {
      const letter = event.key.toLocaleLowerCase();
      const after = [...enabled.slice(position + 1), ...enabled.slice(0, position + 1)];
      move(after.find((index) => actions[index]?.label.toLocaleLowerCase().startsWith(letter)));
    }
  }

  let actionIndex = -1;
  return (
    <div ref={anchor} className={cx("tp-menu-anchor", className)}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        className={cx(
          "tp-btn",
          iconOnly && "tp-btn--icon",
          variant !== "primary" && !iconOnly && `tp-btn--${variant}`,
          size !== "md" && `tp-btn--${size}`
        )}
        aria-label={iconOnly ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openAt(enabled[0]))}
        onKeyDown={onTriggerKeyDown}
      >
        {icon && <Icon name={icon} />}
        {!iconOnly && label}
        {children}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-labelledby={triggerId} className="tp-menu tp-menu--popover" onKeyDown={onMenuKeyDown}>
          {items.map((item, position) => {
            if (item === "separator") return <div key={`sep-${position}`} role="separator" className="tp-menu__sep" />;
            const index = ++actionIndex;
            return (
              <button
                key={index}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                className={cx("tp-menu__item", item.danger && "tp-menu__item--danger")}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

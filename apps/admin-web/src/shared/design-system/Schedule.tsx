import type { CSSProperties, ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { formatDate, type IsoDate } from "../utilities/dates";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

const weekdayNarrow = new Intl.DateTimeFormat("he-IL", { weekday: "narrow" });
const fullDate = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" });
const asDate = (iso: IsoDate) => new Date(`${iso}T00:00:00`);

export type ClassColor = "sage" | "rose" | "taupe" | "blue" | "amber" | "mauve";

export interface TabBarLink {
  to: string;
  label: string;
  icon: IconName;
}

export interface TabBarProps {
  items: readonly TabBarLink[];
  /** The raised middle button, e.g. booking a class. */
  action?: TabBarLink;
  label?: string;
}

/** The phone app's bottom navigation, fixed to the screen; the current page gets aria-current. */
export function TabBar({ items, action, label = "ניווט" }: TabBarProps) {
  const middle = Math.ceil(items.length / 2);
  const link = (item: TabBarLink) => (
    <NavLink key={item.to} to={item.to} end className="tp-tabbar__item">
      <Icon name={item.icon} />
      {item.label}
    </NavLink>
  );
  return (
    <nav className="tp-tabbar tp-tabbar--fixed" aria-label={label}>
      {items.slice(0, middle).map(link)}
      {action && (
        <Link to={action.to} className="tp-tabbar__fab" aria-label={action.label}>
          <Icon name={action.icon} />
        </Link>
      )}
      {items.slice(middle).map(link)}
    </nav>
  );
}

export interface WeekStripProps {
  days: readonly IsoDate[];
  value: IsoDate;
  onChange: (day: IsoDate) => void;
  today?: IsoDate;
  label?: string;
}

/** Seven days in a well; each button is named by its full date ("יום רביעי, 14 באוקטובר"). */
export function WeekStrip({ days, value, onChange, today, label = "ימי השבוע" }: WeekStripProps) {
  return (
    <div role="group" aria-label={label} className="tp-week">
      {days.map((day) => (
        <button
          key={day}
          type="button"
          className="tp-week__day"
          aria-pressed={day === value}
          aria-label={`${fullDate.format(asDate(day))}${day === today ? ", היום" : ""}`}
          onClick={() => onChange(day)}
        >
          {weekdayNarrow.format(asDate(day))}
          <b>{Number(day.slice(8, 10))}</b>
        </button>
      ))}
    </div>
  );
}

/** The start time in a well, with the length or the day under it. */
export function TimeSlot({ time, children }: { time: string; children?: ReactNode }) {
  return (
    <span className="tp-slot">
      {time}
      {children && <small>{children}</small>}
    </span>
  );
}

export interface FilterChipsProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}

/** A row of chips that filter a list; the pressed one is sage. */
export function FilterChips<T extends string>({ options, value, onChange, label }: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className="tp-row" style={{ gap: 8 }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx("tp-chip", "tp-chip--plain", option.value === value && "tp-chip--brand")}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface EventCardProps {
  title: string;
  meta: ReactNode;
  color: ClassColor;
  /** How full the class is, 0 to 1. */
  fill: number;
  /** The corner label, e.g. "3 מקומות" or "מלא · המתנה". */
  badge: string;
  to?: string;
  /** Opens something in place (a dialog); the tile becomes a button. */
  onClick?: () => void;
  /** Struck through, on a sunken tile. */
  cancelled?: boolean;
}

/** A class tile with its category stripe, a fill bar and a corner label. */
export function EventCard({ title, meta, color, fill, badge, to, onClick, cancelled = false }: EventCardProps) {
  const className = cx("tp-event", cancelled ? "tp-event--cancelled" : `tp-event--${color}`);
  const style = { "--tp-fill": `${Math.round(Math.min(Math.max(fill, 0), 1) * 100)}%` } as CSSProperties;
  const content = (
    <>
      <span className="tp-event__count">{badge}</span>
      <span className="tp-event__title">{title}</span>
      <span className="tp-event__meta">{meta}</span>
      <span className="tp-event__fill" aria-hidden="true">
        <i />
      </span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={className} style={style} onClick={onClick}>
        {content}
      </button>
    );
  }
  return to ? (
    <Link to={to} className={className} style={style}>
      {content}
    </Link>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
}

export interface ClassRowProps {
  slot: ReactNode;
  title: string;
  meta: ReactNode;
  /** Buttons or a status chip at the end of the row. */
  actions?: ReactNode;
  as?: "div" | "li";
}

/** A class card: time slot, title and meta, and actions. */
export function ClassRow({ slot, title, meta, actions, as: Tag = "div" }: ClassRowProps) {
  return (
    <Tag className="tp-class">
      {slot}
      <span className="tp-class__body">
        <span className="tp-class__title">{title}</span>
        <span className="tp-class__meta">{meta}</span>
      </span>
      {actions && <div className="tp-class__actions">{actions}</div>}
    </Tag>
  );
}

/** "14.10", the short date for lists. */
export function shortDate(iso: IsoDate): string {
  return formatDate(iso).slice(0, 5);
}

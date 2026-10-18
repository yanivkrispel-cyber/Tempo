import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
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
  const compact = useCompactOnScroll();
  const link = (item: TabBarLink) => (
    <NavLink key={item.to} to={item.to} end className="tp-tabbar__item">
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </NavLink>
  );
  return (
    <nav className={cx("tp-tabbar tp-tabbar--fixed", compact && "tp-tabbar--compact")} aria-label={label}>
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

/**
 * The floating tab bar gives the page room while it scrolls down and comes back as soon as it scrolls up (P1, as
 * iOS does). Labels stay in the accessibility tree; only their text is hidden.
 */
function useCompactOnScroll(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setCompact(y > 80 && y > last);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return compact;
}

export interface SideNavProps extends TabBarProps {
  /** Above the links, e.g. the studio's name. */
  header?: ReactNode;
}

/**
 * The tab bar's links as a column at the start, for a computer or a tablet held sideways: each label beside its icon,
 * and the main action as a full-width button under them.
 */
export function SideNav({ items, action, label = "ניווט", header }: SideNavProps) {
  return (
    <nav className="tp-sidenav" aria-label={label}>
      {header}
      <div className="tp-nav">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end className="tp-nav__item">
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </div>
      {action && (
        <Link to={action.to} className="tp-btn tp-btn--block">
          <Icon name={action.icon} />
          {action.label}
        </Link>
      )}
    </nav>
  );
}

export interface WeekStripProps {
  days: readonly IsoDate[];
  value: IsoDate;
  onChange: (day: IsoDate) => void;
  today?: IsoDate;
  label?: string;
  /** Days with a booking get a dot under the date. */
  marked?: ReadonlySet<IsoDate>;
}

/** Seven days in a well; each button is named by its full date ("יום רביעי, 14 באוקטובר"). */
export function WeekStrip({ days, value, onChange, today, label = "ימי השבוע", marked }: WeekStripProps) {
  return (
    <div role="group" aria-label={label} className="tp-week">
      {days.map((day) => (
        <button
          key={day}
          type="button"
          className="tp-week__day"
          aria-pressed={day === value}
          aria-label={`${fullDate.format(asDate(day))}${day === today ? ", היום" : ""}${marked?.has(day) ? ", יש לך שיעור" : ""}`}
          onClick={() => onChange(day)}
        >
          {weekdayNarrow.format(asDate(day))}
          <b style={day === today ? { color: "var(--brand-ink)" } : undefined}>{Number(day.slice(8, 10))}</b>
          <span
            className="tp-week__dot"
            style={marked?.has(day) ? undefined : { background: "transparent" }}
            aria-hidden="true"
          />
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
  /** Struck through, on a sunken tile. */
  cancelled?: boolean;
}

/** A class tile with its category stripe, a fill bar, and a label at the end of the title's line (under it on a narrow tile). */
export function EventCard({ title, meta, color, fill, badge, to, cancelled = false }: EventCardProps) {
  const className = cx("tp-event", cancelled ? "tp-event--cancelled" : `tp-event--${color}`);
  const style = { "--tp-fill": `${Math.round(Math.min(Math.max(fill, 0), 1) * 100)}%` } as CSSProperties;
  const content = (
    <>
      {/* The name first, for a screen reader; the CSS keeps the label at the line's end either way (#319). */}
      <span className="tp-event__title">{title}</span>
      <span className="tp-event__count">{badge}</span>
      <span className="tp-event__meta">{meta}</span>
      <span className="tp-event__fill" aria-hidden="true">
        <i />
      </span>
    </>
  );
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
  /** Makes the title and meta a link to the class, as in the mockup (AppBook → AppClass). */
  to?: string;
}

/** A class card: time slot, title and meta, and actions. */
export function ClassRow({ slot, title, meta, actions, as: Tag = "div", to }: ClassRowProps) {
  const body = (
    <>
      <span className="tp-class__title">{title}</span>
      <span className="tp-class__meta">{meta}</span>
    </>
  );
  return (
    <Tag className="tp-class">
      {slot}
      {to ? (
        <Link to={to} className="tp-class__body">
          {body}
        </Link>
      ) : (
        <span className="tp-class__body">{body}</span>
      )}
      {actions && <div className="tp-class__actions">{actions}</div>}
    </Tag>
  );
}

/** "14.10", the short date for lists. */
export function shortDate(iso: IsoDate): string {
  return formatDate(iso).slice(0, 5);
}

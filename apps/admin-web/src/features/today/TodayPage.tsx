import { useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Link, useSearchParams } from "react-router";
import { nameOf, useAccount } from "../../account/account";
import { errorMessage } from "../../api/errors";
import {
  Avatar,
  Banner,
  Button,
  ButtonLink,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  Segmented,
  Skeleton,
  cx,
  type ChipTone,
  type IconName,
} from "../../shared/design-system";
import { useMediaQuery, WIDE_SCREEN } from "../../shared/useMediaQuery";
import { StudioClock } from "../../shared/studio/StudioClock";
import { addDays, dayOfWeek, formatDate, todayIn } from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";
import {
  useActivity,
  useOccupancy,
  useSales,
  useSessionSpots,
  useSuggestions,
  type Activity,
  type Occupancy,
  type Sales,
  type Suggestion,
} from "../console/experience";
import { useOpenCommandPalette } from "../console/CommandPalette";
import { useStudio } from "../console/studio";
import { priceLabel } from "../passes/queries";

// The month's figures in whole shekels, as on OwnerDashboard.dc.html: agorot would only add noise to a total.
const wholeShekels = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });
import { ScanDialog } from "../schedule/LiveRoom";
import { NewClassDialog } from "../schedule/NewClassDialog";
import { occupancy, sessionBadge, useSessions, weekdayNames, type Session } from "../schedule/queries";
import styles from "./today.module.css";

type Day = "today" | "tomorrow";

const minute = 60_000;

/**
 * `/o/:slug/today`: the studio's day at a glance (docs/33 section 9, OwnerDashboard mockup). The class in the room
 * now, the month's sales and the week's occupancy, what is waiting for the owner, the day's classes and what just
 * happened. Each part shows only to who may see it; the coach at the door gets the live class and the list (D15).
 */
export function TodayPage() {
  return <StudioClock>{(timeZone) => <DayView timeZone={timeZone} />}</StudioClock>;
}

function DayView({ timeZone }: { timeZone: string }) {
  const studio = useStudio();
  const me = useAccount();
  const wide = useMediaQuery(WIDE_SCREEN, true);
  const openPalette = useOpenCommandPalette();
  const [day, setDay] = useState<Day>("today");
  const [creating, setCreating] = useState(false);
  // When the page opened: a class that started meanwhile shows as started after a reload, as on the class page.
  const [openedAt] = useState(() => Date.now());
  const today = todayIn(timeZone);
  const date = day === "today" ? today : addDays(today, 1);
  const sessions = useSessions(date, date);
  const reports = studio.can("reports.view");
  const suggestions = useSuggestions(reports);
  const waiting = reports ? (suggestions.data?.length ?? 0) : 0;
  // The feed hides when it can't load (a role without it, or an API without it) rather than showing an error box.
  const activity = useActivity(reports && studio.can("people.view"));
  const feed = reports && studio.can("people.view") && !activity.isError;
  // The installed app's "door scan" shortcut: the server finds the class whose check-in is open.
  const [params, setParams] = useSearchParams();
  const scanning = params.get("open") === "scan" && studio.can("attendance.mark");
  const attention = useRef<HTMLHeadingElement>(null);

  const all = [...(sessions.data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const mine = all.filter((session) => session.instructor?.membershipId === studio.membership.membershipId);
  const others = all.filter((session) => !mine.includes(session));
  const dayWord = day === "today" ? "היום" : "מחר";
  const live = day === "today" ? liveSession(all, openedAt) : null;
  const summary = sessions.data && day === "today" ? daySummary(all, dayWord) : null;

  // "מחכה לך" further down: the bell and the greeting's link take the owner there and focus its heading.
  const showWaiting = () => {
    const heading = attention.current;
    if (!heading) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView?.({ behavior: still ? "auto" : "smooth", block: "start" });
    heading.focus({ preventScroll: true });
  };
  const waitingWords = waiting === 1 ? "דבר אחד מחכה לך" : `${waiting} דברים מחכים לך`;

  const list = (items: Session[]) => (
    <Card className={styles.day}>
      <ul className={styles.list}>
        {items.map((session) => (
          <SessionRow key={session.id} session={session} timeZone={timeZone} openedAt={openedAt} />
        ))}
      </ul>
    </Card>
  );

  return (
    <>
      {scanning && <ScanDialog onClose={() => setParams({}, { replace: true })} />}
      {/* The OwnerDashboard mockup's top bar. On a phone the console's app bar already holds the search. */}
      <div className={styles.topbar}>
        {wide && openPalette && (
          <button type="button" className={styles.search} onClick={openPalette}>
            <Icon name="search" />
            <span>חיפוש מתאמנת, שיעור או פעולה</span>
            <kbd className="tp-kbd" dir="ltr">
              Ctrl K
            </kbd>
          </button>
        )}
        <span className={styles.spacer} />
        {waiting > 0 && <IconButton icon="bell" label={waitingWords} count={waiting} onClick={showWaiting} />}
        {studio.can("schedule.manage") && (
          <Button icon="plus" onClick={() => setCreating(true)}>
            שיעור חדש
          </Button>
        )}
      </div>

      <header className={styles.heading}>
        <span className="tp-eyebrow tp-num">
          יום {weekdayNames[dayOfWeek(today)]} · {formatDate(today)}
        </span>
        <h1 className={styles.greeting}>
          {greeting(openedAt, timeZone)}, <bdi>{firstName(nameOf(me))}</bdi>
        </h1>
        {/* While the day loads, an empty line holds the summary's place so the page does not jump (O5). */}
        {(summary || waiting > 0 || (sessions.isPending && day === "today")) && (
          <p className={`tp-muted ${styles.summary}`} aria-hidden={summary || waiting > 0 ? undefined : true}>
            {summary ?? (waiting > 0 ? "" : " ")}
            {waiting > 0 && (
              <>
                {summary && " "}
                <button type="button" className={styles.summaryLink} onClick={showWaiting}>
                  {waitingWords}
                </button>
                .
              </>
            )}
          </p>
        )}
      </header>

      <div className={styles.page}>
        {(live || reports) && (
          <div className={live ? styles.first : `${styles.first} ${styles.firstEven}`}>
            {live && <LiveCard session={live} timeZone={timeZone} openedAt={openedAt} />}
            {reports && <SalesCard />}
            {reports && <OccupancyCard wide={live !== null} />}
          </div>
        )}

        {reports && <Suggestions suggestions={suggestions.data ?? []} timeZone={timeZone} heading={attention} />}

        <div className={feed ? styles.lower : undefined}>
          <section className={styles.dayPart} aria-labelledby="today-day">
            <div className={styles.dayHead}>
              <div className={styles.heading}>
                <h2 id="today-day" className={styles.dayTitle}>
                  {dayWord} בסטודיו
                </h2>
                {day === "tomorrow" && (
                  <span className="tp-caption tp-num">
                    יום {weekdayNames[dayOfWeek(date)]} · {formatDate(date)}
                  </span>
                )}
              </div>
              <div className={styles.tools}>
                <Segmented
                  label="איזה יום"
                  value={day}
                  onChange={setDay}
                  options={[
                    { value: "today", label: "היום" },
                    { value: "tomorrow", label: "מחר" },
                  ]}
                />
                <ButtonLink to={`/o/${studio.slug}/schedule`} variant="ghost" size="sm" icon="calendar">
                  מערכת שבועית
                </ButtonLink>
              </div>
            </div>

            {sessions.isError ? (
              <Banner tone="danger" icon="info">
                {errorMessage(sessions.error, "לא הצלחנו לטעון את השיעורים. נסו שוב.")}
              </Banner>
            ) : !sessions.data ? (
              <div aria-busy="true" className="tp-stack">
                <span className="tp-sr-only">טוענים את השיעורים…</span>
                <Skeleton height={96} />
                <Skeleton height={96} />
              </div>
            ) : all.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={`אין שיעורים ${dayWord}.`}
                action={
                  <ButtonLink to={`/o/${studio.slug}/schedule`} variant="secondary">
                    למערכת השבועית
                  </ButtonLink>
                }
              >
                שיעור חדש או שיעור קבוע נוספים מהמערכת השבועית.
              </EmptyState>
            ) : mine.length > 0 ? (
              <>
                <section className={styles.section} aria-labelledby="today-mine">
                  <h3 id="today-mine" className={styles.subTitle}>
                    השיעורים שלי
                  </h3>
                  {list(mine)}
                </section>
                {others.length > 0 && (
                  <section className={styles.section} aria-labelledby="today-others">
                    <h3 id="today-others" className={styles.subTitle}>
                      שאר השיעורים {dayWord}
                    </h3>
                    {list(others)}
                  </section>
                )}
              </>
            ) : (
              <section className={styles.section} aria-label={`השיעורים ${dayWord}`}>
                {list(all)}
              </section>
            )}
          </section>

          {feed && (
            <aside className={styles.side} aria-labelledby="activity-title">
              <ActivityFeed timeZone={timeZone} openedAt={openedAt} />
            </aside>
          )}
        </div>
      </div>

      {creating && <NewClassDialog day={date} today={today} onClose={() => setCreating(false)} />}
    </>
  );
}

const hourFormat = new Map<string, Intl.DateTimeFormat>();

/** "בוקר טוב" by the studio's own clock, as the mockup greets the owner. */
function greeting(at: number, timeZone: string): string {
  let format = hourFormat.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone });
    hourFormat.set(timeZone, format);
  }
  const hour = Number(format.format(at));
  if (hour >= 5 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  if (hour >= 17 && hour < 22) return "ערב טוב";
  return "לילה טוב";
}

/** The first word of a display name; an email's local part stays whole. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** The class in the room now, or the next one today when it starts within an hour and a half. */
function liveSession(sessions: Session[], now: number): Session | null {
  const scheduled = sessions.filter((session) => session.status === "scheduled");
  const running = scheduled.find(
    (session) => new Date(session.startsAt).getTime() <= now && now < new Date(session.endsAt).getTime(),
  );
  if (running) return running;
  return (
    scheduled.find((session) => {
      const starts = new Date(session.startsAt).getTime();
      return starts > now && starts - now <= 90 * minute;
    }) ?? null
  );
}

/** The live class (P2): the photo under a scrim, who is in the room, and the way to the room map. */
function LiveCard({ session, timeZone, openedAt }: { session: Session; timeZone: string; openedAt: number }) {
  const studio = useStudio();
  const instructor = session.instructor?.membershipId === studio.membership.membershipId;
  const staff = studio.can("bookings.manage") || instructor;
  const spots = useSessionSpots(session.id, staff && session.room?.spotSelection === true, true);
  const started = new Date(session.startsAt).getTime() <= openedAt;
  const minutesLeft = Math.max(1, Math.round((new Date(session.startsAt).getTime() - openedAt) / minute));
  const arrived = spots.data?.spots.filter((spot) => spot.attendance === "attended").length ?? 0;

  return (
    <section className={`tp-hero ${styles.live}`} aria-labelledby="live-title">
      {session.classType.coverUrl && <img className="tp-hero__photo" src={session.classType.coverUrl} alt="" />}
      <div className="tp-hero__top">
        <span className="tp-chip tp-glass-dark">
          <span className="tp-live" aria-hidden="true" />
          {started ? "עכשיו בחדר" : `מתחיל בעוד ${minutesLeft} דק׳`}
        </span>
        <span className="tp-chip tp-glass-dark tp-num">
          {clockTime(session.startsAt, timeZone)} עד {clockTime(session.endsAt, timeZone)}
        </span>
      </div>
      <div className="tp-hero__body">
        <div className="tp-hero__text">
          <h2 id="live-title" className="tp-hero__title">
            <bdi>{session.classType.name}</bdi>
          </h2>
          <span className="tp-hero__meta">
            {session.instructor && (
              <>
                <Avatar name={session.instructor.displayName} size="sm" />
                <bdi>{session.instructor.displayName}</bdi>
              </>
            )}
            {session.room && <span>· {session.room.name}</span>}
          </span>
        </div>
        <div className={`tp-glass ${styles.liveGlass}`}>
          <dl className={styles.liveStats}>
            <div>
              <dt>רשומים</dt>
              <dd className="tp-num">
                {session.bookedCount}
                <small> מתוך {session.capacity}</small>
              </dd>
            </div>
            {spots.data?.spotSelection && (
              <div>
                <dt>הגיעו</dt>
                <dd className="tp-num">{arrived}</dd>
              </div>
            )}
            <div>
              <dt>בהמתנה</dt>
              <dd className="tp-num">{session.waitlistCount}</dd>
            </div>
          </dl>
          <ButtonLink
            to={
              staff && session.room?.spotSelection
                ? `/o/${studio.slug}/live/${session.id}`
                : `/o/${studio.slug}/schedule/sessions/${session.id}`
            }
            icon={staff ? "qr" : undefined}
          >
            {staff ? "מסך השיעור" : "לשיעור"}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

/** Pass sales this month against the previous month to the same day, with the forecast (docs/33 X-9). */
function SalesCard() {
  const sales = useSales(true);
  if (sales.isError) return null;
  if (!sales.data) return <Skeleton height={188} />;
  const data = sales.data;
  const change =
    data.previousToDateAgorot > 0
      ? Math.round(((data.soFarAgorot - data.previousToDateAgorot) / data.previousToDateAgorot) * 100)
      : null;
  return (
    <Card as="section" className={styles.kpi} aria-labelledby="sales-title">
      <h2 id="sales-title" className="tp-eyebrow">
        מכירות החודש
      </h2>
      <div className={styles.kpiFigure}>
        <span className={`tp-display tp-num ${styles.kpiValue}`}>{wholeShekels.format(data.soFarAgorot / 100)}</span>
        {change !== null && (
          <ChangeChip up={change >= 0}>
            <span className="tp-num">{Math.abs(change)}%</span> {change >= 0 ? "יותר" : "פחות"} מ
            {previousMonthName(data.month)} באותו זמן
          </ChangeChip>
        )}
      </div>
      <Sparkline sales={data} />
      <span className="tp-caption">
        {data.passesSold} כרטיסיות ומנויים
        {data.forecastAgorot != null && <> · צפי לסוף החודש {wholeShekels.format(data.forecastAgorot / 100)}</>}
        {data.unpricedCount > 0 && <> · {data.unpricedCount} בלי מחיר</>}
      </span>
    </Card>
  );
}

const monthName = new Intl.DateTimeFormat("he-IL", { month: "long", timeZone: "UTC" });

/** "ספטמבר" for the month "2026-10". */
function previousMonthName(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return monthName.format(new Date(Date.UTC(year!, number! - 2, 1)));
}

/** The change said in words beside the figure, as the mockup does (O6); the arrow shows which way. */
function ChangeChip({ up, children }: { up: boolean; children: ReactNode }) {
  return (
    <Chip tone={up ? "success" : "warning"}>
      <Icon name={up ? "arrow-up" : "arrow-down"} width={12} height={12} />
      <span>{children}</span>
    </Chip>
  );
}

/**
 * The month's running total as a soft line across the whole month, and the forecast as a dashed line on to the
 * month's last day; decoration, the numbers say it.
 */
function Sparkline({ sales }: { sales: Sales }) {
  const days = sales.days;
  if (days.length < 2) return <div className={styles.spark} aria-hidden="true" />;
  const [year, number] = sales.month.split("-").map(Number);
  const monthDays = new Date(Date.UTC(year!, number!, 0)).getUTCDate();
  const forecast = sales.forecastAgorot ?? null;
  const top = Math.max(1, forecast ?? 0, ...days.map((day) => day.cumulativeAgorot));
  const width = 300;
  const height = 64;
  const x = (dayOfMonth: number) => ((dayOfMonth - 1) / (monthDays - 1)) * width;
  const y = (value: number) => height - 4 - (value / top) * (height - 8);
  const points = days.map((day) => [x(Number(day.day.slice(8, 10))), y(day.cumulativeAgorot)] as const);
  const line = points.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const [firstX] = points[0]!;
  const [lastX, lastY] = points[points.length - 1]!;
  return (
    <div className={styles.spark} dir="ltr" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="tp-spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--sage)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--sage)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${line} L${lastX.toFixed(1)} ${height} L${firstX.toFixed(1)} ${height} Z`}
          fill="url(#tp-spark-fill)"
        />
        <path
          d={line}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2.2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {forecast !== null && lastX < width && (
          <path
            d={`M${lastX.toFixed(1)} ${lastY.toFixed(1)} L${width} ${y(forecast).toFixed(1)}`}
            fill="none"
            stroke="var(--rose)"
            strokeWidth="2"
            strokeDasharray="5 5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

const parts: { key: Occupancy["cells"][number]["part"]; label: string }[] = [
  { key: "morning", label: "בוקר" },
  { key: "noon", label: "צהריים" },
  { key: "evening", label: "ערב" },
];
const dayLetters = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

/** The week's places against capacity, and where it is full: days across, parts of the day down. */
function OccupancyCard({ wide }: { wide: boolean }) {
  const occupancy = useOccupancy(true);
  if (occupancy.isError) return null;
  if (!occupancy.data) return <Skeleton height={188} className={wide ? styles.span : undefined} />;
  const data = occupancy.data;
  const share = data.capacity > 0 ? Math.round((data.places / data.capacity) * 100) : 0;
  const previous =
    data.previousCapacity && data.previousPlaces != null
      ? Math.round((data.previousPlaces / data.previousCapacity) * 100)
      : null;
  const days = [...new Set(data.cells.map((cell) => cell.day))].sort();
  const cell = (day: string, part: string) => data.cells.find((item) => item.day === day && item.part === part);
  return (
    <Card as="section" className={cx(styles.kpi, wide && styles.span)} aria-labelledby="occupancy-title">
      <h2 id="occupancy-title" className="tp-eyebrow">
        תפוסה השבוע
      </h2>
      <div className={styles.kpiFigure}>
        <span className={`tp-display tp-num ${styles.kpiValue}`}>{share}%</span>
        {previous !== null && (
          <ChangeChip up={share >= previous}>
            <span className="tp-num">{previous}%</span> בשבוע שעבר
          </ChangeChip>
        )}
      </div>
      <div
        className={`tp-heat ${styles.heat}`}
        style={{ "--tp-days": Math.max(1, days.length) } as CSSProperties}
        role="table"
        aria-label="תפוסה לפי יום וחלק ביום"
      >
        <div role="row" className={styles.heatRow}>
          <span role="columnheader" />
          {days.map((day) => (
            <span key={day} role="columnheader" className={styles.heatDay}>
              {dayLetters[dayOfWeek(day)]}
            </span>
          ))}
        </div>
        {parts.map((part) => (
          <div key={part.key} role="row" className={styles.heatRow}>
            <span role="rowheader">{part.label}</span>
            {days.map((day) => {
              const item = cell(day, part.key);
              const ratio = item && item.capacity > 0 ? item.places / item.capacity : 0;
              const level = !item || item.capacity === 0 ? 0 : ratio < 0.4 ? 1 : ratio < 0.6 ? 2 : ratio < 0.85 ? 3 : 4;
              const tone = item?.fullWithWaitlist ? " tp-heat__cell--hot" : level ? ` tp-heat__cell--${level}` : "";
              return (
                <span
                  key={day}
                  role="cell"
                  className={`tp-heat__cell${tone}`}
                  aria-label={
                    !item || item.capacity === 0
                      ? "אין שיעורים"
                      : `${item.places} מתוך ${item.capacity}${item.fullWithWaitlist ? ", מלא עם ממתינים" : ""}`
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <ul className={styles.heatLegend} aria-hidden="true">
        <li>
          <i className="tp-heat__cell tp-heat__cell--hot" />
          מלא עם המתנה
        </li>
        <li>
          <i className="tp-heat__cell tp-heat__cell--4" />
          <span className="tp-num">מעל 85%</span>
        </li>
        <li>
          <i className="tp-heat__cell tp-heat__cell--1" />
          יש מקום
        </li>
      </ul>
    </Card>
  );
}

/** Up to three "waiting for you" cards, each with its next step. The bell and the greeting's link focus its heading. */
function Suggestions({
  suggestions,
  timeZone,
  heading,
}: {
  suggestions: Suggestion[];
  timeZone: string;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="suggestions-title">
      <h2 id="suggestions-title" ref={heading} tabIndex={-1} className={styles.attentionTitle}>
        מחכה לך
      </h2>
      <ul className={styles.insights}>
        {suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.kind + (suggestion.sessionId ?? "")}
            suggestion={suggestion}
            timeZone={timeZone}
          />
        ))}
      </ul>
    </section>
  );
}

function SuggestionCard({ suggestion, timeZone }: { suggestion: Suggestion; timeZone: string }) {
  const studio = useStudio();
  const names = suggestion.people.slice(0, 3);
  const more = suggestion.count - names.length;
  const text = suggestionText(suggestion, timeZone);
  const to = text.publish
    ? `/o/${studio.slug}/publish?${new URLSearchParams(text.publish).toString()}`
    : suggestion.sessionId
      ? `/o/${studio.slug}/schedule/sessions/${suggestion.sessionId}`
      : suggestion.count === 1 && names[0]
        ? `/o/${studio.slug}/people/${names[0].id}`
        : `/o/${studio.slug}/people`;
  return (
    <li className="tp-insight">
      <div className={styles.insightHead}>
        <span className="tp-insight__tile" style={{ background: text.tile, color: text.ink }}>
          <Icon name={text.icon} />
        </span>
        <h3>{text.title}</h3>
      </div>
      {names.length > 0 && (
        <div className={styles.faces}>
          <span className={styles.stack}>
            {names.map((person) => (
              <Avatar key={person.id} name={person.displayName} src={person.avatarUrl ?? undefined} size="sm" />
            ))}
          </span>
          <span className="tp-caption">
            {names.map((person) => person.displayName).join(", ")}
            {more > 0 && ` ועוד ${more}`}
          </span>
        </div>
      )}
      {text.body && <p className="tp-muted">{text.body}</p>}
      <ButtonLink to={to} variant="secondary" size="sm" className={styles.insightAction}>
        {text.action}
      </ButtonLink>
    </li>
  );
}

function suggestionText(
  suggestion: Suggestion,
  timeZone: string,
): {
  icon: IconName;
  tile: string;
  ink: string;
  title: string;
  body: string | null;
  action: string;
  /** The story it opens on the publish page, for the `story_*` cards. */
  publish?: Record<string, string>;
} {
  const one = suggestion.count === 1;
  switch (suggestion.kind) {
    case "passes_ending":
      return {
        icon: "credit-card",
        tile: "var(--rose-soft)",
        ink: "var(--rose-ink)",
        title: one ? "כרטיסייה אחת מסתיימת השבוע" : `${suggestion.count} כרטיסיות מסתיימות השבוע`,
        body: suggestion.amountAgorot ? `חידוש שווה ${priceLabel(suggestion.amountAgorot)}.` : null,
        action: one ? "לכרטיס המתאמן" : "לרשימת האנשים",
      };
    case "members_at_risk":
      return {
        icon: "clock",
        tile: "var(--warning-soft)",
        ink: "var(--warning-ink)",
        title: one ? "מתאמן.ת אחד.ת לא הגיע.ה לאחרונה" : `${suggestion.count} מתאמנים לא הגיעו לאחרונה`,
        body: "הודעה אישית עכשיו מחזירה יותר מתאמנים מהודעה בעוד חודש.",
        action: one ? "לכרטיס המתאמן" : "לרשימת האנשים",
      };
    case "waitlist_pressure":
      return {
        icon: "trending-up",
        tile: "var(--brand-soft)",
        ink: "var(--brand-ink)",
        title: `${suggestion.className ?? "שיעור"} מלא, ${suggestion.count} ממתינים`,
        body: suggestion.slot
          ? `יש זמן פנוי באותו יום ב־${clockTime(suggestion.slot.startsAt, timeZone)}${suggestion.slot.roomName ? `, ${suggestion.slot.roomName}` : ""}. שיעור נוסף יכניס אותם.`
          : null,
        action: "לשיעור",
      };
    case "story_weekly":
      return {
        icon: "share",
        tile: "var(--brand-soft)",
        ink: "var(--brand-ink)",
        title: "הסטורי של השבוע מוכן",
        body: one ? "שיעור אחד השבוע, עם התפוסה שלו." : `${suggestion.count} שיעורים השבוע, עם התפוסה של כל אחד.`,
        action: "לסטורי",
        publish: { template: "week" },
      };
    case "story_spot_opened":
      return {
        icon: "share",
        tile: "var(--success-soft)",
        ink: "var(--success-ink)",
        title: suggestion.startsAt
          ? `התפנה מקום ב-${clockTime(suggestion.startsAt, timeZone)}, לפרסם?`
          : "התפנה מקום, לפרסם?",
        body: `${suggestion.className ?? "השיעור"}: ${one ? "מקום אחד פנוי" : `${suggestion.count} מקומות פנויים`} ורשימת ההמתנה כבר סגורה.`,
        action: "לסטורי",
        publish: suggestion.sessionId
          ? { template: "spot_opened", session: suggestion.sessionId }
          : { template: "spot_opened" },
      };
    case "story_schedule_changed":
      return {
        icon: "share",
        tile: "var(--warning-soft)",
        ink: "var(--warning-ink)",
        title: "המערכת השתנתה, לעדכן את העוקבות?",
        body: one ? "שיעור אחד בשבוע הקרוב השתנה." : `${suggestion.count} שיעורים בשבוע הקרוב השתנו.`,
        action: "לסטורי",
        publish: { template: "change" },
      };
  }
}

const activityVerb: Record<Activity["kind"], string> = {
  "booking.created": "נרשם.ה ל",
  "booking.waitlisted": "נכנס.ה להמתנה ל",
  "booking.cancelled": "ביטל.ה את ההרשמה ל",
  "booking.promoted": "עלה.תה מההמתנה ל",
  "booking.checked_in": "הגיע.ה ל",
  "pass.granted": "קיבל.ה ",
  "health.declaration.signed": "חתם.ה על הצהרת בריאות",
};

/** What happened in the last 48 hours, newest first. */
function ActivityFeed({ timeZone, openedAt }: { timeZone: string; openedAt: number }) {
  const studio = useStudio();
  const activity = useActivity(true);
  return (
    <Card className={styles.feed}>
      <h2 id="activity-title" className={`tp-eyebrow ${styles.feedTitle}`}>
        <span className="tp-live tp-live--sage" aria-hidden="true" />
        מה קורה בסטודיו
      </h2>
      {activity.isError ? (
        <p className="tp-caption">לא הצלחנו לטעון את הפעילות.</p>
      ) : !activity.data ? (
        <Skeleton height={160} />
      ) : activity.data.length === 0 ? (
        <p className="tp-caption">ביומיים האחרונים עוד לא קרה כלום.</p>
      ) : (
        <ul className={styles.feedList}>
          {activity.data.map((item, index) => (
            <li key={`${item.kind}-${item.at}-${index}`} className="tp-activity">
              <Avatar name={item.person.displayName} src={item.person.avatarUrl ?? undefined} size="sm" />
              <span>
                <Link to={`/o/${studio.slug}/people/${item.person.id}`} className={styles.feedName}>
                  <bdi>{item.person.displayName}</bdi>
                </Link>{" "}
                {activityVerb[item.kind]}
                {item.className && <bdi>{item.className}</bdi>}
                {item.classStartsAt && <span className="tp-num"> {clockTime(item.classStartsAt, timeZone)}</span>}
                {item.spotLabel && <> · מכשיר {item.spotLabel}</>}
                {item.productName && <bdi>{item.productName}</bdi>}
                {item.priceAgorot != null && <> · {priceLabel(item.priceAgorot)}</>}
                <time dateTime={item.at}>{ago(item.at, openedAt)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ago(at: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(at).getTime()) / minute));
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "לפני שעה" : `לפני ${hours} שעות`;
}

/** "היום 9 שיעורים ו־78 נרשמים.": the day in a line under the heading; cancelled classes don't count. */
function daySummary(sessions: Session[], dayWord: string): string | null {
  const held = sessions.filter((session) => session.status !== "cancelled");
  if (held.length === 0) return null;
  const classes = held.length === 1 ? "שיעור אחד" : `${held.length} שיעורים`;
  const booked = held.reduce((sum, session) => sum + session.bookedCount, 0);
  if (booked === 0) return `${dayWord} ${classes}, עוד אין נרשמים.`;
  return booked === 1 ? `${dayWord} ${classes} ורישום אחד.` : `${dayWord} ${classes} ו־${booked} נרשמים.`;
}

/**
 * One class as a row of the day's table (OwnerDashboard mockup): when, what, where and with whom, a bar of how full
 * it is, and its state now. The whole row opens the class page.
 */
function SessionRow({ session, timeZone, openedAt }: { session: Session; timeZone: string; openedAt: number }) {
  const studio = useStudio();
  const start = clockTime(session.startsAt, timeZone);
  const end = clockTime(session.endsAt, timeZone);
  const where = [session.room?.name, session.instructor?.displayName].filter(Boolean).join(" · ");
  const cancelled = session.status === "cancelled";
  const fill = session.capacity > 0 ? Math.min(100, Math.round((session.bookedCount / session.capacity) * 100)) : 0;
  return (
    <li>
      <Link
        to={`/o/${studio.slug}/schedule/sessions/${session.id}`}
        className={`${styles.row}${cancelled ? ` ${styles.rowCancelled}` : ""}`}
      >
        <span className={`tp-num ${styles.rowTime}`}>{start}</span>
        <span className={styles.rowText}>
          <strong className={styles.rowTitle}>
            <bdi>{session.classType.name}</bdi>
          </strong>
          <span className="tp-caption">
            <span className="tp-num">
              {start} עד {end}
            </span>
            {where && <> · {where}</>}
          </span>
        </span>
        <span className={styles.rowFill}>
          {cancelled ? (
            <span className="tp-caption">המתאמנים קיבלו הודעה</span>
          ) : (
            <>
              <span
                role="meter"
                aria-label={`תפוסה, ${session.bookedCount} מתוך ${session.capacity}`}
                aria-valuemin={0}
                aria-valuemax={session.capacity}
                aria-valuenow={session.bookedCount}
                className={`tp-bar tp-bar--sage ${styles.rowBar}`}
                style={{ "--tp-bar": `${fill}%` } as CSSProperties}
              >
                <span className="tp-bar__fill" />
              </span>
              <span className="tp-caption tp-num">{occupancy(session)}</span>
            </>
          )}
        </span>
        <span className={styles.rowState}>
          <StateChip session={session} openedAt={openedAt} />
        </span>
      </Link>
    </li>
  );
}

function StateChip({ session, openedAt }: { session: Session; openedAt: number }) {
  const [tone, text]: [ChipTone, string] =
    session.status === "cancelled"
      ? ["danger", "בוטל"]
      : new Date(session.endsAt).getTime() <= openedAt
        ? ["neutral", "הסתיים"]
        : new Date(session.startsAt).getTime() <= openedAt
          ? ["brand", "עכשיו"]
          : session.bookedCount >= session.capacity
            ? ["warning", sessionBadge(session)]
            : ["success", sessionBadge(session)];
  return <Chip tone={tone}>{text}</Chip>;
}

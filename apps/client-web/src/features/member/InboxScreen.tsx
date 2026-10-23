import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Card, Chip, EmptyState, Icon, IconButton, type ChipTone, type IconName } from "../../shared/design-system";
import { addDays, type IsoDate } from "../../shared/utilities/dates";
import { dayName, relativeDay } from "./format";
import styles from "./member.module.css";
import { metaLine } from "./passText";
import { RichText } from "./richText";
import { useInbox, useMarkRead, useSession, useStudio, useStudioClock, type InboxItem, type Studio } from "./studio";
import { ListSkeleton, LoadError, NoStudio } from "./StudioGate";
import { clockTime, studioDate } from "./studioTime";

const title = "התראות";

/**
 * What each kind of in-app notification says (docs/29 sections 4.2, 6.3, 11, 16.1 and 16.2), when the item does not
 * carry the studio's words (`title`/`body`, docs/30 step 7; absent on older items). Unknown kinds are not shown.
 */
const kinds: Record<string, { title: string; body: string; icon: IconName; tone: ChipTone }> = {
  "booking.promoted": {
    title: "התפנה מקום ונרשמת",
    body: "נרשמת אוטומטית מרשימת ההמתנה, ונוצלה כניסה מהכרטיסייה.",
    icon: "check",
    tone: "success",
  },
  "booking.promotion_failed": {
    title: "התפנה מקום, אבל אין כרטיסייה בתוקף",
    body: "לכן יצאת מרשימת ההמתנה. כדי להירשם, פנו לסטודיו.",
    icon: "credit-card",
    tone: "warning",
  },
  "booking.moved": {
    title: "הסטודיו העביר אותך לשיעור אחר",
    body: "המקום שלך עבר לשיעור הזה, עם אותה כניסה: לא נוצלה כניסה נוספת.",
    icon: "calendar",
    tone: "info",
  },
  "session.cancelled": {
    title: "הסטודיו ביטל שיעור",
    body: "אם נרשמת, הכניסה חזרה אליך.",
    icon: "calendar",
    tone: "warning",
  },
  // The studio's own words (docs/29 section 16.2): the body is the item's text, shown as written.
  "session.message": {
    title: "הודעה מהסטודיו על השיעור",
    body: "",
    icon: "info",
    tone: "info",
  },
  "waitlist.expired": {
    title: "לא התפנה מקום",
    body: "השיעור התחיל ורשימת ההמתנה נסגרה. לא נוצלה כניסה.",
    icon: "clock",
    tone: "neutral",
  },
  // Reminders (docs/30 section 7, D-5). The class's name and time come from the session, as for the other kinds.
  "reminder.class_tomorrow": {
    title: "תזכורת: יש לך שיעור מחר",
    body: "אם התוכניות השתנו, אפשר לבטל בעמוד השיעור ולפנות את המקום.",
    icon: "calendar",
    tone: "info",
  },
  "reminder.class_soon": {
    title: "תזכורת: השיעור מתחיל בקרוב",
    body: "כל הפרטים בעמוד השיעור.",
    icon: "clock",
    tone: "info",
  },
  // A5 (docs/29 section 16.4): the item carries the passId only; the push points here for the details.
  "pass.frozen": {
    title: "הסטודיו הקפיא את המנוי שלך",
    body: "בימי ההקפאה אי אפשר להירשם לשיעורים, והתוקף של המנוי הוארך באותו מספר ימים.",
    icon: "credit-card",
    tone: "info",
  },
  "reminder.pass_ending": {
    title: "המנוי או הכרטיסייה עומדים לפוג",
    body: "כדי להמשיך להירשם לשיעורים, פנו לסטודיו לחידוש.",
    icon: "credit-card",
    tone: "warning",
  },
  "reminder.entries_low": {
    title: "נשארו מעט כניסות בכרטיסייה",
    body: "כדי להמשיך להירשם לשיעורים, פנו לסטודיו לכרטיסייה חדשה.",
    icon: "credit-card",
    tone: "warning",
  },
  // Celebrations (docs/37 section 8.2): her milestone opens its card; a friend's first class names the reward.
  "member.milestone": {
    title: "הגעת לאבן דרך",
    body: "הכרטיס שלך מוכן, אם בא לך לשתף.",
    icon: "star",
    tone: "brand",
  },
  "member.referral_rewarded": {
    title: "חברה שהזמנת הגיעה לשיעור הראשון",
    body: "תודה שהבאת אותה. קיבלת כרטיסייה מהסטודיו, והיא כבר אצלך בפרופיל.",
    icon: "gift",
    tone: "success",
  },
  // A message to the whole studio (docs/30 step 7): its subject comes as `title` and its text as `text`.
  "studio.announcement": {
    title: "הודעה מהסטודיו",
    body: "",
    icon: "info",
    tone: "info",
  },
};

export function knownNotices(items: readonly InboxItem[]): InboxItem[] {
  return items.filter((item) => item.kind in kinds);
}

/** The heading over a day's notices: "היום", "אתמול" or "יום שלישי 13.10". */
function dayHeading(date: IsoDate, today: IsoDate): string {
  if (date === today) return "היום";
  if (date === addDays(today, -1)) return "אתמול";
  return `${dayName(date)} ${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

export function InboxScreen() {
  const studio = useStudio();
  return studio ? <StudioInbox studio={studio} /> : <NoStudio title={title} />;
}

function StudioInbox({ studio }: { studio: Studio }) {
  const inbox = useInbox(studio.id);
  const { timeZone, today } = useStudioClock(studio.id);
  const navigate = useNavigate();
  const items = inbox.data ? knownNotices(inbox.data.items) : [];

  return (
    <main className={`tp-page tp-page--tabbar ${styles.screen}`} aria-busy={inbox.isPending}>
      <header className={styles.header}>
        <IconButton icon="chevron-right" label="חזרה" onClick={() => navigate("/")} />
        <div className={styles.heading}>
          <span className="tp-eyebrow">{studio.name}</span>
          <h1 className={styles.title}>{title}</h1>
        </div>
      </header>

      {inbox.isPending ? (
        <ListSkeleton />
      ) : inbox.isError ? (
        <LoadError error={inbox.error} onRetry={() => void inbox.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="אין התראות">
          כשיתפנה לך מקום מרשימת ההמתנה או ששיעור ישתנה, נודיע לך כאן.
        </EmptyState>
      ) : (
        <ul className={styles.list} aria-label="התראות">
          {items.map((item, index) => {
            // The list is newest first; the first notice of each day carries that day's heading.
            const day = studioDate(item.createdAt, timeZone);
            const startsDay = index === 0 || studioDate(items[index - 1]!.createdAt, timeZone) !== day;
            return (
              <Notice key={item.id} studio={studio} item={item} heading={startsDay ? dayHeading(day, today) : null} />
            );
          })}
        </ul>
      )}
    </main>
  );
}

/** Where an item opens: its class, her milestone card (the count is the item's text), or her passes for a reward. */
function linkFor(item: InboxItem): string | null {
  if (item.data.sessionId) return `/classes/${item.data.sessionId}`;
  if (item.kind === "member.milestone" && /^\d+$/.test(item.text ?? "")) return `/milestone/${item.text}`;
  if (item.kind === "member.referral_rewarded") return "/profile";
  return null;
}

function Notice({ studio, item, heading }: { studio: Studio; item: InboxItem; heading: string | null }) {
  const { timeZone, today } = useStudioClock(studio.id);
  const markRead = useMarkRead(studio.id);
  const sessionId = item.data.sessionId;
  // The item holds ids only; the class's name and time come from the session, cached across the screens.
  const session = useSession(studio.id, sessionId ?? "", sessionId !== undefined);
  const kind = kinds[item.kind]!;
  const to = linkFor(item);
  const unread = !item.readAt;
  // "New" stays for this visit, even after the item is marked read below.
  const [arrivedUnread] = useState(unread);
  const { mutate: markItemRead } = markRead;
  const seen = useRef(false);
  useEffect(() => {
    // An item with nowhere to open is read once it is shown; one that opens a screen is read when opened.
    if (to || !unread || seen.current) return;
    seen.current = true;
    markItemRead(item.id);
  }, [to, unread, item.id, markItemRead]);
  const when = session.data
    ? metaLine([
        session.data.classType.name,
        `${relativeDay(session.data.localDate, today)} ${clockTime(session.data.startsAt, timeZone)}`,
      ])
    : null;

  const content = (
    <>
      <span className="tp-icon-tile tp-icon-tile--sm">
        <Icon name={kind.icon} />
      </span>
      <span className={styles.noticeBody}>
        <span dir="auto" className={styles.noticeTitle}>
          {item.title || kind.title}
        </span>
        {when && <span>{when}</span>}
        {item.kind === "session.message" ? (
          <span dir="auto" className={styles.noticeText}>
            {item.text}
          </span>
        ) : item.kind === "studio.announcement" || item.body ? (
          <span dir="auto" className={styles.noticeText}>
            {/* A card that is itself a link cannot hold another one. */}
            <RichText text={(item.kind === "studio.announcement" ? item.text : item.body) ?? ""} links={!to} />
          </span>
        ) : (
          <span className="tp-caption">{kind.body}</span>
        )}
        {/* The day is the heading above; the card keeps the time. */}
        <span className="tp-caption tp-num">{clockTime(item.createdAt, timeZone)}</span>
      </span>
      {(to ? unread : arrivedUnread) && <Chip tone="brand">חדש</Chip>}
    </>
  );

  const read = () => {
    if (unread) markRead.mutate(item.id);
  };

  return (
    <li className={heading ? styles.noticeDay : undefined}>
      {heading && <h2 className={`tp-eyebrow ${styles.noticeDayTitle}`}>{heading}</h2>}
      {to ? (
        <Card small to={to} className={styles.notice} onClick={read}>
          {content}
        </Card>
      ) : (
        <Card small className={styles.notice}>
          {content}
        </Card>
      )}
    </li>
  );
}

import { useNavigate } from "react-router";
import { Card, Chip, EmptyState, Icon, IconButton, type ChipTone, type IconName } from "../../shared/design-system";
import { relativeDay } from "./format";
import styles from "./member.module.css";
import { metaLine } from "./passText";
import { RichText } from "./richText";
import { useInbox, useMarkRead, useSession, useStudio, useStudioClock, type InboxItem, type Studio } from "./studio";
import { ListSkeleton, LoadError, NoStudio } from "./StudioGate";
import { clockTime, momentText } from "./studioTime";

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

export function InboxScreen() {
  const studio = useStudio();
  return studio ? <StudioInbox studio={studio} /> : <NoStudio title={title} />;
}

function StudioInbox({ studio }: { studio: Studio }) {
  const inbox = useInbox(studio.id);
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
          {items.map((item) => (
            <Notice key={item.id} studio={studio} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}

function Notice({ studio, item }: { studio: Studio; item: InboxItem }) {
  const { timeZone, today } = useStudioClock(studio.id);
  const markRead = useMarkRead(studio.id);
  const sessionId = item.data.sessionId;
  // The item holds ids only; the class's name and time come from the session, cached across the screens.
  const session = useSession(studio.id, sessionId ?? "", sessionId !== undefined);
  const kind = kinds[item.kind]!;
  const unread = !item.readAt;
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
            <RichText text={(item.kind === "studio.announcement" ? item.text : item.body) ?? ""} links={!sessionId} />
          </span>
        ) : (
          <span className="tp-caption">{kind.body}</span>
        )}
        <span className="tp-caption">{momentText(item.createdAt, timeZone, today)}</span>
      </span>
      {unread && <Chip tone="brand">חדש</Chip>}
    </>
  );

  const read = () => {
    if (unread) markRead.mutate(item.id);
  };

  return (
    <li>
      {sessionId ? (
        <Card small to={`/classes/${sessionId}`} className={styles.notice} onClick={read}>
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

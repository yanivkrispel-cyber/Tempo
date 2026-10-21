import { useEffect, type ReactNode } from "react";
import { useMe } from "../../account/account";
import { studioBasename } from "../../app/studioPath";
import { Button, Dialog, Icon, shortDate, Toggle, useToast, type IconName } from "../../shared/design-system";
import type { IsoDate } from "../../shared/utilities/dates";
import { saveFile } from "../../shared/utilities/saveFile";
import { useShareLink } from "./experience";
import { shortDayName } from "./format";
import { InstallOffer } from "./InstallApp";
import { passTakenText } from "./passText";
import { OpenInBrowserCard } from "./OpenInBrowserCard";
import styles from "./member.module.css";
import { useCalendarFile, type Booking, type Session, type Studio } from "./studio";
import { clockTime } from "./studioTime";

/**
 * "שמרנו לך מקום" (board ח): the place is held. What was booked in one line, what to know before coming, the class
 * in the calendar or sent to a friend, and the app on the home screen where the browser can add it.
 */
export function BookedDialog({
  studio,
  session,
  booking,
  timeZone,
  today,
  freeCancelUntil,
  calendar,
  onClose,
}: {
  studio: Studio;
  session: Session;
  booking: Booking | null;
  timeZone: string;
  today: IsoDate;
  /** "מחר 16:30" while cancelling still returns the entry, else null. */
  freeCancelUntil: string | null;
  /** The page's own calendar download, so a failure shows on the page as before. */
  calendar: ReturnType<typeof useCalendarFile>;
  onClose: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const shareLink = useShareLink(studio.id);
  const mintLink = shareLink.mutate;
  // Her own link is made when the dialog opens and again when the toggle changes, not on the tap: a phone's share
  // sheet opens only from the tap itself, and waiting on the API first would use that up. Opening sends no `showName`,
  // so it keeps her stored choice (SL-8); only the switch changes it.
  const bookingId = booking?.id;
  useEffect(() => {
    if (bookingId) mintLink({ sessionId: session.id });
  }, [bookingId, session.id, mintLink]);
  // SL-8: the invite names her by first name unless she turns it off; null is the default, on.
  const showName = shareLink.data ? (shareLink.data.showName ?? true) : (shareLink.variables?.showName ?? true);
  const first = me.data?.displayName?.trim().split(/\s+/)[0];
  const time = clockTime(session.startsAt, timeZone);
  const day =
    session.localDate === today ? "היום" : `${shortDayName(session.localDate)} ${shortDate(session.localDate)}`;
  const summary = [session.classType.name, `${day} בשעה ${time}`, session.room?.name].filter(Boolean).join(", ");
  const notes: { key: string; icon: IconName; text: ReactNode }[] = [];
  if (booking?.spot) notes.push({ key: "spot", icon: "check", text: `מכשיר ${booking.spot.label} שמור לך` });
  if (freeCancelUntil) notes.push({ key: "cancel", icon: "clock", text: `ביטול חינם עד ${freeCancelUntil}` });
  // The pass it took, said here instead of in a toast that would cover the dialog on a phone.
  const pass = passTakenText(booking?.pass);
  if (pass) notes.push({ key: "pass", icon: "credit-card", text: pass });

  async function share() {
    // Her own link carries the invite; while it is on its way or when it cannot be made, the plain class address goes.
    const url = shareLink.isSuccess
      ? shareLink.data.url
      : `${window.location.origin}${studioBasename(studio.slug)}/c/${session.id}`;
    const text = `בואי איתי ל${session.classType.name}, ${day} ב-${time}`;
    if (navigator.share) {
      await navigator.share({ text, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(`${text}\n${url}`).catch(() => undefined);
    toast.show({ message: "הקישור הועתק" });
  }

  return (
    <Dialog open={booking !== null} onClose={onClose} title={first ? `שמרנו לך מקום, ${first}` : "שמרנו לך מקום"}>
      {booking && (
        <div className={`tp-rise ${styles.booked}`}>
          <span className={styles.doneCheck} aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="30"
              height="30"
              fill="none"
              stroke="#fff"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path className="tp-check-draw" d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <p className={styles.bookedSummary}>
            <bdi>{summary}</bdi>.
          </p>
          {notes.length > 0 && (
            <ul className={styles.bookedNotes}>
              {notes.map((note) => (
                <li key={note.key}>
                  <span className={styles.bookedNoteIcon} aria-hidden="true">
                    <Icon name={note.icon} />
                  </span>
                  <span>{note.text}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.bookedActions}>
            <Button
              variant="secondary"
              icon="calendar"
              loading={calendar.isPending}
              onClick={() =>
                calendar.mutate(booking.id, { onSuccess: (file) => saveFile(file, `tempo-${session.localDate}.ics`) })
              }
            >
              הוספה ליומן
            </Button>
            <Button variant="secondary" icon="share" onClick={() => void share()}>
              שליחה לחברה
            </Button>
          </div>
          <Toggle
            checked={showName}
            disabled={shareLink.isPending}
            onChange={(event) => mintLink({ sessionId: session.id, showName: event.target.checked })}
            label="להציג את השם שלי"
          />
          <InstallOffer appName={studio.name} />
          <OpenInBrowserCard />
          <Button variant="ghost" block onClick={onClose}>
            סגירה
          </Button>
        </div>
      )}
    </Dialog>
  );
}

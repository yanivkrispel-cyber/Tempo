import type { ReactNode } from "react";
import { Banner, Button, Dialog, Icon, useToast } from "../../shared/design-system";
import { errorMessage } from "../../api/errors";
import type { IsoDate } from "../../shared/utilities/dates";
import { freeCancelDeadline, noPassText, passTakenText, passUseText, waitText } from "./bookingState";
import { relativeDay } from "./format";
import styles from "./member.module.css";
import { useBook, type Booking, type BookingPolicy, type Session } from "./studio";
import { clockTime, minutesBetween, momentText } from "./studioTime";

/** Booking, with the result told in a toast. The server decides between a place, the waitlist and a refusal. */
export function useBookingFlow(organizationId: string) {
  const book = useBook(organizationId);
  const toast = useToast();

  function run(session: Session, onDone?: () => void) {
    book.mutate(session.id, {
      onSuccess: (booking: Booking) => {
        onDone?.();
        if (booking.status === "waitlisted") {
          toast.show({
            tone: "success",
            message: `נכנסת לרשימת ההמתנה, ${waitText(booking.waitlistPosition)}. אם יתפנה מקום נרשום אותך ונודיע לך.`,
          });
        } else {
          toast.show({ tone: "success", message: `נרשמת לשיעור. ${passTakenText(booking.pass)}`.trim() });
        }
      },
      onError: (error) => {
        onDone?.();
        toast.show({ tone: "danger", message: errorMessage(error, "ההרשמה לא הצליחה. נסו שוב.") });
      },
    });
  }

  return { run, pendingId: book.isPending ? book.variables : undefined };
}

export interface BookingSheetProps {
  session: Session | null;
  timeZone: string;
  today: IsoDate;
  policy: BookingPolicy | undefined;
  now: Date;
  pending: boolean;
  onConfirm: (session: Session) => void;
  onClose: () => void;
}

/** The bottom sheet before booking: when, with whom, which pass it uses, and until when cancelling is free. */
export function BookingSheet({
  session,
  timeZone,
  today,
  policy,
  now,
  pending,
  onConfirm,
  onClose,
}: BookingSheetProps) {
  const pass = session?.passPreview ?? null;
  const deadline = session ? freeCancelDeadline(session, policy) : null;
  const deadlinePassed = deadline !== null && deadline.getTime() <= now.getTime();

  return (
    <Dialog open={session !== null} onClose={onClose} title={session ? `הרשמה ל${session.classType.name}` : ""}>
      {session && (
        <>
          <SessionDetails session={session} timeZone={timeZone} today={today}>
            {pass && (
              <div className={styles.sheetDetail}>
                <span className="tp-icon-tile tp-icon-tile--sm">
                  <Icon name="credit-card" />
                </span>
                <span>{passUseText(pass)}</span>
              </div>
            )}
          </SessionDetails>
          {!pass && (
            <Banner tone="warning" icon="info" className={styles.sheetNote}>
              {noPassText}
            </Banner>
          )}
          {pass && deadline && (
            <p className={`tp-caption ${styles.sheetNote}`}>
              {deadlinePassed
                ? "עבר זמן הביטול החינמי: אם תבטלו, הכניסה לא תחזור."
                : `ביטול חינם עד ${momentText(deadline, timeZone, today)}. אחרי זה הכניסה נוצלת גם אם תבטלו.`}
            </p>
          )}
          <div className={styles.sheetActions}>
            {pass && (
              <Button size="lg" block loading={pending} onClick={() => onConfirm(session)}>
                אישור ההרשמה
              </Button>
            )}
            <Button variant="ghost" block onClick={onClose} disabled={pending}>
              {pass ? "לא עכשיו" : "סגירה"}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

interface SessionDetailsProps {
  session: Session;
  timeZone: string;
  today: IsoDate;
  /** More lines, e.g. the pass a booking uses. */
  children?: ReactNode;
}

/** When, with whom and where: the lines the booking sheet and the class screen share. */
export function SessionDetails({ session, timeZone, today, children }: SessionDetailsProps) {
  return (
    <div className={styles.sheetDetails}>
      <div className={styles.sheetDetail}>
        <span className="tp-icon-tile tp-icon-tile--sm">
          <Icon name="calendar" />
        </span>
        <span>
          {relativeDay(session.localDate, today)} · {clockTime(session.startsAt, timeZone)} ·{" "}
          {minutesBetween(session.startsAt, session.endsAt)} דק׳
        </span>
      </div>
      {session.instructor && (
        <div className={styles.sheetDetail}>
          <span className="tp-icon-tile tp-icon-tile--sm">
            <Icon name="user" />
          </span>
          <span>עם {session.instructor.displayName}</span>
        </div>
      )}
      {session.room && (
        <div className={styles.sheetDetail}>
          <span className="tp-icon-tile tp-icon-tile--sm">
            <Icon name="map-pin" />
          </span>
          <span>{session.room.name}</span>
        </div>
      )}
      {children}
    </div>
  );
}

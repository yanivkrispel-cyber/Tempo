import type { ReactNode } from "react";
import { Link } from "react-router";
import { Banner, Button, Dialog, Icon, useToast } from "../../shared/design-system";
import { errorMessage, hasCode } from "../../api/errors";
import { formatDate, type IsoDate } from "../../shared/utilities/dates";
import { freeCancelDeadline, freeSpots, noPassText, waitText } from "./bookingState";
import { relativeDay } from "./format";
import styles from "./member.module.css";
import { passTakenText, passUseText, waitPassText } from "./passText";
import { targetSessionId, useBook, type Booking, type BookingPolicy, type Session } from "./studio";
import { SlideToConfirm } from "./Premium";
import { clockTime, minutesBetween, momentText } from "./studioTime";

/**
 * Booking. The server decides between a place, the waitlist and a refusal: a place or a waitlist place closes the
 * sheet with a toast; a refusal keeps the sheet open and `error` explains it there.
 */
export function useBookingFlow(organizationId: string) {
  const book = useBook(organizationId);
  const toast = useToast();

  function run(session: Session, onDone?: (booking: Booking) => void, spotId?: string | null) {
    book.mutate(spotId ? { sessionId: session.id, spotId } : session.id, {
      onSuccess: (booking: Booking) => {
        onDone?.(booking);
        if (booking.status === "waitlisted") {
          toast.show({
            tone: "success",
            message: `נכנסת לרשימת ההמתנה, ${waitText(booking.waitlistPosition)}. אם יתפנה מקום נרשום אותך ונודיע לך.`,
          });
        } else if (!booking.spot) {
          toast.show({
            tone: "success",
            message: <>נרשמת לשיעור. {passTakenText(booking.pass)}</>,
          });
        }
      },
    });
  }

  return {
    run,
    pendingId: book.isPending && book.variables !== undefined ? targetSessionId(book.variables) : undefined,
    /** The last refusal, for the sheet; cleared by `reset` when the sheet opens or closes. */
    error: book.isError ? book.error : null,
    reset: book.reset,
  };
}

export interface BookingSheetProps {
  session: Session | null;
  timeZone: string;
  today: IsoDate;
  policy: BookingPolicy | undefined;
  now: Date;
  pending: boolean;
  /** Why the server refused the last try; the sheet stays open to say so. */
  error?: unknown;
  /** The spot chosen on the room map, when the room has spots. */
  spot?: { label: string; note?: string } | null;
  /** The room has spots and the member chose none: the server picks the usual or first free one. */
  spotsAuto?: boolean;
  onConfirm: (session: Session) => void;
  onClose: () => void;
}

/**
 * The bottom sheet before booking: when, with whom, which pass it uses, and until when cancelling is free. On a full
 * class it joins the waitlist instead: no entry is held while waiting (docs/29 C-2), one is taken on promotion.
 */
export function BookingSheet({
  session,
  timeZone,
  today,
  policy,
  now,
  pending,
  error = null,
  spot = null,
  spotsAuto = false,
  onConfirm,
  onClose,
}: BookingSheetProps) {
  const pass = session?.passPreview ?? null;
  const waitlist = session !== null && freeSpots(session) === 0;
  const deadline = session ? freeCancelDeadline(session, policy) : null;
  const deadlinePassed = deadline !== null && deadline.getTime() <= now.getTime();
  const title = session ? (
    <>
      {waitlist ? "רשימת ההמתנה לשיעור" : "הרשמה לשיעור"} <bdi>{session.classType.name}</bdi>
    </>
  ) : (
    ""
  );

  return (
    <Dialog open={session !== null} onClose={onClose} title={title}>
      {session && (
        <>
          <SessionDetails session={session} timeZone={timeZone} today={today}>
            {!waitlist && (spot || spotsAuto) && (
              <div className={styles.sheetDetail}>
                <span className="tp-icon-tile tp-icon-tile--sm">
                  <Icon name="star" />
                </span>
                <span>
                  {spot ? (
                    <>
                      <strong>מכשיר {spot.label}</strong>
                      {spot.note && <> · {spot.note}</>}
                    </>
                  ) : (
                    "נשריין לך את המכשיר הקבוע שלך, או את הראשון שפנוי"
                  )}
                </span>
              </div>
            )}
            {pass && (
              <div className={styles.sheetDetail}>
                <span className="tp-icon-tile tp-icon-tile--sm">
                  <Icon name="credit-card" />
                </span>
                <span>{waitlist ? waitPassText(pass) : passUseText(pass)}</span>
              </div>
            )}
          </SessionDetails>
          {hasCode(error, "health.declaration_required") ? (
            <Banner tone="warning" icon="info" className={styles.sheetNote}>
              הסטודיו מבקש הצהרת בריאות חתומה לפני ההרשמה לשיעורים.{" "}
              <Link to="/profile/health">למילוי הצהרת הבריאות</Link>
            </Banner>
          ) : (
            error !== null && (
              <Banner tone="danger" icon="info" className={styles.sheetNote}>
                {errorMessage(
                  error,
                  waitlist ? "ההצטרפות לרשימת ההמתנה לא הצליחה. נסו שוב." : "ההרשמה לא הצליחה. נסו שוב.",
                )}
              </Banner>
            )
          )}
          {!pass && (
            <Banner tone="warning" icon="info" className={styles.sheetNote}>
              {session.frozenUntil
                ? `המנוי שלך מוקפא עד ${formatDate(session.frozenUntil)}, ולכן אי אפשר להירשם לשיעור הזה.`
                : noPassText}
            </Banner>
          )}
          {pass && waitlist && (
            <p className={`tp-caption ${styles.sheetNote}`}>
              {session.waitlistCount === 0
                ? "השיעור מלא, ואין עדיין אף אחד בהמתנה."
                : `השיעור מלא. ${session.waitlistCount === 1 ? "ממתין אחד" : `${session.waitlistCount} ממתינים`} לפניך.`}{" "}
              אם יתפנה מקום, נרשום אותך אוטומטית ונודיע לך.
            </p>
          )}
          {pass && !waitlist && deadline && (
            <p className={`tp-caption ${styles.sheetNote}`}>
              {deadlinePassed
                ? "עבר זמן הביטול החינמי: אם תבטלו, הכניסה לא תחזור."
                : `ביטול חינם עד ${momentText(deadline, timeZone, today)}. אחרי זה הכניסה נוצלת גם אם תבטלו.`}
            </p>
          )}
          <div className={styles.sheetActions}>
            {pass &&
              (waitlist ? (
                <Button size="lg" block loading={pending} onClick={() => onConfirm(session)}>
                  הצטרפות לרשימת ההמתנה
                </Button>
              ) : (
                <SlideToConfirm
                  label={spot ? `החליקו כדי לשריין את מכשיר ${spot.label}` : "החליקו כדי לשריין"}
                  actionLabel={spot ? `אישור ההרשמה, מכשיר ${spot.label}` : "אישור ההרשמה"}
                  pending={pending}
                  onConfirm={() => onConfirm(session)}
                />
              ))}
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
          <span>
            עם <bdi>{session.instructor.displayName}</bdi>
          </span>
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

import { Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { lazyNamed } from "../../app/lazyScreen";
import { Dialog, Icon } from "../../shared/design-system";
import { useCheckinCode } from "./experience";
import { clockTime } from "./studioTime";

// qrcode-generator loads with the pass, not with the home screen (board #511, S-3).
const QrCode = lazyNamed(() => import("./QrCode"), "QrCode");

const qrPlaceholder = <div className="tp-skeleton" style={{ width: 232, height: 232, borderRadius: 16 }} />;

/**
 * The check-in pass (docs/33 section 8, D19): a QR that changes every 30 seconds, for staff to scan at the door. It
 * says which class it opens, or when check-in opens for the next one.
 */
export function CheckinPass({
  organizationId,
  timeZone,
  open,
  onClose,
}: {
  organizationId: string;
  timeZone: string;
  open: boolean;
  onClose: () => void;
}) {
  const code = useCheckinCode(organizationId, open);
  const data = code.data;
  // The QR's chunk downloads while the code is fetched, not after it.
  useEffect(() => {
    if (open) import("./QrCode").catch(() => undefined);
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="כרטיס כניסה">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
        {data ? (
          <>
            <Suspense fallback={qrPlaceholder}>
              <QrCode value={data.code} label="קוד לסריקה בכניסה לסטודיו" size={232} />
            </Suspense>
            {data.openClass ? (
              <p>
                <strong>
                  <bdi>{data.openClass.className}</bdi> · {clockTime(data.openClass.startsAt, timeZone)}
                </strong>
                {data.openClass.spotLabel && <> · מכשיר {data.openClass.spotLabel}</>}
                <br />
                <span className="tp-caption">הראו את הקוד בכניסה. הוא מתחלף כל חצי דקה.</span>
              </p>
            ) : data.nextClass ? (
              <p className="tp-caption">
                הצ׳ק־אין לשיעור <bdi>{data.nextClass.className}</bdi> נפתח ב-
                {clockTime(data.nextClass.opensAt, timeZone)}.
              </p>
            ) : (
              <p className="tp-caption">אין שיעור שנפתח לצ׳ק־אין היום.</p>
            )}
          </>
        ) : code.isError ? (
          <p className="tp-caption">לא הצלחנו להציג את הקוד. נסו שוב בעוד רגע.</p>
        ) : (
          qrPlaceholder
        )}
      </div>
    </Dialog>
  );
}

/** The countdown ring in the hero: minutes to the class over the last three hours. */
export function CountdownRing({ minutesLeft }: { minutesLeft: number }) {
  const circumference = 2 * Math.PI * 27;
  const share = Math.min(1, Math.max(0, minutesLeft / 180));
  const hours = Math.floor(minutesLeft / 60);
  const minutes = String(minutesLeft % 60).padStart(2, "0");
  return (
    <div
      className="tp-ring-count"
      role="img"
      aria-label={`מתחיל בעוד ${hours > 0 ? `${hours} שעות ו־` : ""}${Number(minutes)} דקות`}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="tp-ring-count__track" cx="32" cy="32" r="27" />
        <circle
          className="tp-ring-count__value"
          cx="32"
          cy="32"
          r="27"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * share}
        />
      </svg>
      <span className="tp-ring-count__label" aria-hidden="true" dir="ltr">
        {hours}:{minutes}
        <small dir="rtl">{hours > 0 ? "שעות" : "דקות"}</small>
      </span>
    </div>
  );
}

/**
 * Slide to confirm (P4): drag the knob to the end, or press it (a tap, Enter, a screen reader). The slide runs from
 * the start edge to the end edge, so right to left in Hebrew.
 */
export function SlideToConfirm({
  label,
  actionLabel,
  pending,
  onConfirm,
}: {
  label: string;
  actionLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);
  const [travel, setTravel] = useState(240);
  const moved = useRef(false);
  const rtl = typeof document !== "undefined" && document.documentElement.dir !== "ltr";
  const wasPending = useRef(pending);
  // When the action settles and this control is still on screen, it failed: bring the knob back to try again.
  useEffect(() => {
    if (wasPending.current && !pending) setDrag(0);
    wasPending.current = pending;
  }, [pending]);

  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    if (pending) return;
    start.current = event.clientX;
    moved.current = false;
    setTravel(Math.max(120, (event.currentTarget.parentElement?.clientWidth ?? 300) - 60));
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }
  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    const delta = rtl ? start.current - event.clientX : event.clientX - start.current;
    if (Math.abs(delta) > 4) moved.current = true;
    setDrag(Math.min(1, Math.max(0, delta / travel)));
  }
  function up() {
    if (!dragging) return;
    setDragging(false);
    if (drag > 0.8) {
      setDrag(1);
      onConfirm();
    } else setDrag(0);
  }
  function click() {
    if (moved.current || pending) {
      moved.current = false;
      return;
    }
    setDrag(1);
    onConfirm();
  }
  const offset = Math.round(drag * travel) * (rtl ? -1 : 1);
  return (
    <div className="tp-slide">
      <span
        className="tp-slide__label"
        style={{ opacity: pending ? 0 : Math.max(0, 1 - drag * 1.6) }}
        aria-hidden="true"
      >
        {label}
      </span>
      <button
        type="button"
        className={`tp-slide__knob${dragging ? " tp-slide__knob--drag" : ""}`}
        style={{ transform: `translateX(${pending ? (rtl ? -travel : travel) : offset}px)` }}
        aria-label={actionLabel}
        aria-busy={pending}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={click}
      >
        <Icon name={rtl ? "chevrons-left" : "chevron-right"} />
      </button>
    </div>
  );
}

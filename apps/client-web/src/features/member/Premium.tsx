import qrcode from "qrcode-generator";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Dialog, Icon } from "../../shared/design-system";
import { useCheckinCode } from "./experience";
import { clockTime } from "./studioTime";

/** A QR code as inline SVG with the standard's four-module quiet zone. */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const { modules, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (code.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
    }
    return { modules: count + 8, path: d };
  }, [value]);
  return (
    <svg
      className="tp-qr"
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="var(--ink)" />
    </svg>
  );
}

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
  return (
    <Dialog open={open} onClose={onClose} title="כרטיס כניסה">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
        {data ? (
          <>
            <QrCode value={data.code} label="קוד לסריקה בכניסה לסטודיו" size={232} />
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
          <div className="tp-skeleton" style={{ width: 232, height: 232, borderRadius: 16 }} />
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

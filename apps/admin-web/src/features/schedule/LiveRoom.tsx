import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@tempo/api-client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Card, Dialog, Icon, Skeleton, initials, useToast } from "../../shared/design-system";
import { useCheckin, useMoveSpot, useSessionSpots, type Checkin, type SessionSpot } from "../console/experience";
import { useStudio } from "../console/studio";
import type { Session } from "./queries";

const minute = 60_000;
const day = 24 * 60 * minute;

const healthText: Record<string, string> = {
  missing: "אין הצהרת בריאות",
  expired: "הצהרת הבריאות פגה",
  needs_medical_approval: "ממתין.ה לאישור רפואי",
};

/**
 * The room during the class (docs/33 section 8, OwnerLive mockup): who is on each spot, who came in, health flags.
 * Tap a spot to mark attendance or move the person; "סריקת כניסה" opens the camera for the members' check-in QR.
 * For the desk (`bookings.manage`) and the class's own instructor, in a room with spot selection.
 */
export function LiveRoom({ session }: { session: Session }) {
  const studio = useStudio();
  const [now] = useState(() => Date.now());
  const starts = new Date(session.startsAt).getTime();
  const ends = new Date(session.endsAt).getTime();
  const live = now >= starts - 30 * minute && now <= ends;
  const spots = useSessionSpots(session.id, true, live);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const move = useMoveSpot(session.id);
  const toast = useToast();
  const instructor = session.instructor?.membershipId === studio.membership.membershipId;
  const scheduled = session.status === "scheduled";
  const markable =
    (studio.can("attendance.mark") || instructor) &&
    scheduled &&
    now >= starts - 30 * minute &&
    now <= starts + 7 * day;
  const movable = studio.can("bookings.manage") && scheduled && now < ends;

  if (spots.isError) return null;
  if (!spots.data) return <Skeleton height={320} />;
  const map = spots.data;
  if (!map.spotSelection) return null;

  const held = map.spots.filter((spot) => spot.bookingId);
  const arrived = held.filter((spot) => spot.attendance === "attended").length;
  const selected = map.spots.find((spot) => spot.id === selectedId && spot.bookingId) ?? null;

  const choose = (spot: SessionSpot) => {
    if (moving && selected && spot.state === "free") {
      move.mutate(
        { bookingId: selected.bookingId!, spotId: spot.id },
        {
          onSuccess: () => {
            toast.show({
              tone: "success",
              icon: "check",
              message: `${selected.person?.displayName ?? ""} עבר.ה למכשיר ${spot.label}`,
            });
            setMoving(false);
            setSelectedId(spot.id);
          },
          onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
        },
      );
      return;
    }
    if (spot.bookingId) {
      setMoving(false);
      setSelectedId(spot.id === selectedId ? null : spot.id);
    }
  };

  return (
    <Card as="section" aria-labelledby="live-room" className="tp-stack">
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <div className="tp-stack" style={{ gap: 2 }}>
          <h2 id="live-room" className="tp-row" style={{ gap: 8 }}>
            {live && <span className="tp-live tp-live--sage" aria-hidden="true" />}
            החדר
          </h2>
          <span className="tp-caption tp-num">
            {arrived} הגיעו מתוך {held.length} · {map.spots.filter((spot) => spot.state === "free").length} פנויים
          </span>
        </div>
        {markable && (
          <Button icon="qr" onClick={() => setScanning(true)}>
            סריקת כניסה
          </Button>
        )}
      </div>

      <StaffRoomMap
        map={map}
        selectedId={selected?.id ?? null}
        moving={moving}
        onChoose={choose}
        instructorName={session.instructor?.displayName}
      />

      {moving && (
        <Banner tone="info" icon="info">
          בחרו מכשיר פנוי עבור <bdi>{selected?.person?.displayName}</bdi>.
        </Banner>
      )}

      {selected && !moving && (
        <SpotActions
          spot={selected}
          markable={markable}
          movable={movable && map.spots.some((spot) => spot.state === "free")}
          onMove={() => setMoving(true)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {scanning && <ScanDialog session={session} onClose={() => setScanning(false)} />}
    </Card>
  );
}

/** The room from above as staff see it: names and faces on the spots, a check on who came in. */
function StaffRoomMap({
  map,
  selectedId,
  moving,
  onChoose,
  instructorName,
}: {
  map: NonNullable<ReturnType<typeof useSessionSpots>["data"]>;
  selectedId: string | null;
  moving: boolean;
  onChoose: (spot: SessionSpot) => void;
  instructorName?: string;
}) {
  const style = { "--tp-cols": map.cols ?? 5 } as CSSProperties;
  return (
    <div className="tp-room">
      {map.windowSide === "start" && <div className="tp-room__light" aria-hidden="true" />}
      {map.windowSide === "end" && <div className="tp-room__light tp-room__light--end" aria-hidden="true" />}
      {map.mirrorFront && <div className="tp-room__mirror" aria-hidden="true" />}
      <div className="tp-room__front">
        <span>{map.windowSide === "start" ? "חלון" : null}</span>
        <span className="tp-chip tp-chip--plain">{instructorName ? <bdi>{instructorName}</bdi> : "הדרכה"}</span>
        <span>{map.windowSide === "end" ? "חלון" : map.mirrorFront ? "קיר מראות" : null}</span>
      </div>
      <div className="tp-room__grid" style={style} role="group" aria-label="המכשירים בחדר">
        {map.spots.map((spot) => (
          <StaffSpot key={spot.id} spot={spot} selected={spot.id === selectedId} moving={moving} onChoose={onChoose} />
        ))}
      </div>
    </div>
  );
}

function StaffSpot({
  spot,
  selected,
  moving,
  onChoose,
}: {
  spot: SessionSpot;
  selected: boolean;
  moving: boolean;
  onChoose: (spot: SessionSpot) => void;
}) {
  const person = spot.person;
  const held = Boolean(spot.bookingId);
  const arrived = spot.attendance === "attended";
  const flagged = held && spot.healthStatus != null && spot.healthStatus !== "signed";
  const enabled = held || (moving && spot.state === "free");
  const className = [
    "tp-spot",
    spot.state === "maintenance" && "tp-spot--maintenance",
    !held && spot.state !== "maintenance" && "tp-spot--free-staff",
    arrived && "tp-spot--in",
    spot.attendance === "no_show" && "tp-spot--waiting",
  ]
    .filter(Boolean)
    .join(" ");
  const label = [
    `מכשיר ${spot.label}`,
    person ? person.displayName : spot.state === "maintenance" ? "בתחזוקה" : "פנוי",
    arrived ? "הגיע.ה" : spot.attendance === "no_show" ? "לא הגיע.ה" : null,
    flagged ? healthText[spot.healthStatus!] : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div style={{ gridRow: spot.row + 1, gridColumn: spot.col + 1, minWidth: 0 }}>
      <button
        type="button"
        className={className}
        aria-pressed={selected}
        aria-label={label}
        disabled={!enabled}
        onClick={() => onChoose(spot)}
      >
        {spot.state === "maintenance" ? (
          <span className="tp-spot__who" style={{ display: "grid", placeItems: "center" }}>
            <Icon name="wrench" />
          </span>
        ) : person ? (
          <span className="tp-spot__who tp-avatar">
            {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person.displayName)}
          </span>
        ) : null}
        {arrived && (
          <span className="tp-spot__mark tp-spot__mark--in">
            <Icon name="check" />
          </span>
        )}
        {flagged && (
          <span className="tp-spot__mark tp-spot__mark--flag">
            <Icon name="info" />
          </span>
        )}
        <span className="tp-spot__label">{spot.label}</span>
      </button>
      {person && <span className="tp-spot__name">{person.displayName.split(" ")[0]}</span>}
    </div>
  );
}

/** The selected spot: who, health, and attendance and move. */
function SpotActions({
  spot,
  markable,
  movable,
  onMove,
  onClose,
}: {
  spot: SessionSpot;
  markable: boolean;
  movable: boolean;
  onMove: () => void;
  onClose: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { organizationId } = useStudio();
  const mark = useMutation({
    mutationKey: [organizationId, "schedule.mark"],
    mutationFn: (state: "attended" | "no_show") =>
      unwrap(
        api.POST("/api/v1/organizations/{organizationId}/bookings/{bookingId}/attendance", {
          params: { path: { organizationId, bookingId: spot.bookingId! } },
          body: { state },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["studio", organizationId, "schedule"] }),
    onError: (error) => toast.show({ tone: "danger", icon: "info", message: errorMessage(error) }),
  });
  const name = spot.person?.displayName ?? "";
  const state = mark.isPending ? mark.variables : spot.attendance;
  return (
    <div className="tp-glass tp-stack" style={{ padding: 14, borderRadius: 20, gap: 10 }}>
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <strong>
          <bdi>{name}</bdi> · מכשיר {spot.label}
        </strong>
        <Button variant="ghost" size="sm" onClick={onClose}>
          סגירה
        </Button>
      </div>
      {spot.healthStatus && spot.healthStatus !== "signed" && (
        <Banner tone="warning" icon="info">
          {healthText[spot.healthStatus]}
        </Banner>
      )}
      <div className="tp-row" style={{ gap: 8 }}>
        {markable && (
          <div role="group" aria-label={`נוכחות של ${name}`} className="tp-seg">
            {(
              [
                ["attended", "הגיע.ה"],
                ["no_show", "לא הגיע.ה"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="tp-seg__opt"
                aria-pressed={state === value}
                disabled={mark.isPending}
                onClick={() => state !== value && mark.mutate(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {movable && (
          <Button variant="secondary" size="sm" onClick={onMove}>
            העברה למכשיר אחר
          </Button>
        )}
      </div>
    </div>
  );
}

interface Detector {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

/**
 * The camera at the door: reads the member's check-in QR with the browser's BarcodeDetector, or with jsQR where
 * there is none (Safari), loaded only when the scanner opens. Each person shows for a moment, then the next.
 */
export function ScanDialog({ session, onClose }: { session?: Session; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const checkin = useCheckin();
  const [status, setStatus] = useState<"starting" | "scanning" | "denied" | "unsupported">("starting");
  const [result, setResult] = useState<Checkin | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const last = useRef<{ code: string; at: number } | null>(null);
  const mutate = checkin.mutate;
  const sessionId = session?.id;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const canvas = document.createElement("canvas");

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setStatus("denied");
        return;
      }
      if (stopped || !video.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      setStatus("scanning");
      const native = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => Detector })
        .BarcodeDetector;
      const detector = native ? new native({ formats: ["qr_code"] }) : null;
      const jsqr = detector ? null : (await import("jsqr")).default;

      const read = async (): Promise<string | null> => {
        const element = video.current;
        if (!element || element.readyState < 2) return null;
        if (detector) return (await detector.detect(element))[0]?.rawValue ?? null;
        const width = element.videoWidth;
        const height = element.videoHeight;
        if (!width || !height || !jsqr) return null;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(element, 0, 0, width, height);
        return jsqr(context.getImageData(0, 0, width, height).data, width, height)?.data ?? null;
      };

      timer = window.setInterval(() => {
        if (busy.current) return;
        busy.current = true;
        read()
          .then((code) => {
            const seen = last.current;
            if (!code || (seen && seen.code === code && Date.now() - seen.at < 4000)) {
              busy.current = false;
              return;
            }
            last.current = { code, at: Date.now() };
            mutate(
              { code, ...(sessionId ? { sessionId } : {}) },
              {
                onSuccess: (checked) => {
                  setProblem(null);
                  setResult(checked);
                  navigator.vibrate?.(60);
                },
                onError: (error) => {
                  setResult(null);
                  setProblem(errorMessage(error, "הקוד לא נקרא. נסו שוב."));
                },
                onSettled: () => {
                  window.setTimeout(() => (busy.current = false), 1200);
                },
              },
            );
          })
          .catch(() => (busy.current = false));
      }, 300);
    }

    void start();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [mutate, sessionId]);

  return (
    <Dialog open onClose={onClose} title="סריקת כניסה" description="כוונו את המצלמה לקוד בכרטיס הכניסה של המתאמן.ת.">
      <div className="tp-stack" style={{ alignItems: "center" }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 360,
            aspectRatio: "1",
            borderRadius: 24,
            overflow: "hidden",
            background: "var(--ink)",
          }}
        >
          <video
            ref={video}
            muted
            playsInline
            aria-label="תמונת המצלמה"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: "18%",
              borderRadius: 20,
              boxShadow: "0 0 0 2px #ffffffcc, 0 0 0 999px #18130f59",
            }}
          />
        </div>
        {status === "denied" && (
          <Banner tone="warning" icon="info">
            אין גישה למצלמה. אפשרו אותה בהגדרות הדפדפן ופתחו את הסריקה שוב.
          </Banner>
        )}
        {status === "unsupported" && (
          <Banner tone="warning" icon="info">
            הדפדפן הזה לא נותן גישה למצלמה. אפשר לסמן נוכחות ברשימת המשתתפים.
          </Banner>
        )}
        <div aria-live="polite" style={{ width: "100%" }}>
          {result && (
            <div className="tp-glass tp-row tp-rise" style={{ padding: 12, borderRadius: 18, gap: 12 }}>
              <span className="tp-avatar">
                {result.person.avatarUrl ? (
                  <img src={result.person.avatarUrl} alt="" />
                ) : (
                  initials(result.person.displayName)
                )}
              </span>
              <span className="tp-stack" style={{ gap: 2 }}>
                <strong>
                  <bdi>{result.person.displayName}</bdi>
                  {result.alreadyCheckedIn ? " כבר בפנים" : " נכנס.ה"}
                </strong>
                <span className="tp-caption">
                  {result.spotLabel ? `מכשיר ${result.spotLabel}` : "בלי מכשיר"}
                  {result.healthStatus !== "signed" && ` · ${healthText[result.healthStatus]}`}
                </span>
              </span>
            </div>
          )}
          {problem && (
            <Banner tone="danger" icon="info">
              {problem}
            </Banner>
          )}
        </div>
        <Button variant="secondary" block onClick={onClose}>
          סיום
        </Button>
      </div>
    </Dialog>
  );
}

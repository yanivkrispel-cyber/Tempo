import { useState, type CSSProperties } from "react";
import { errorMessage } from "../../api/errors";
import { Banner, Button, Checkbox, Dialog, Field, Icon, Select, Skeleton, useToast } from "../../shared/design-system";
import { useRoomLayout, useSaveRoomLayout, type RoomLayout, type RoomLayoutRequest } from "../console/experience";
import type { Room } from "./queries";

type Spot = RoomLayoutRequest["spots"][number];
type Kind = NonNullable<Spot["kind"]>;
type WindowSide = RoomLayout["windowSide"];

const kinds: { value: Kind; label: string }[] = [
  { value: "reformer", label: "רפורמר" },
  { value: "mat", label: "מזרן" },
  { value: "bike", label: "אופניים" },
  { value: "tower", label: "טאוור" },
  { value: "chair", label: "כיסא" },
  { value: "place", label: "מקום" },
];
const sizes = Array.from({ length: 12 }, (_, index) => index + 1);

/**
 * A room that was never mapped starts with spot selection on and one reformer per place, front row first, in a grid
 * as close to square as fits (D20 in docs/claude-memory/decisions.md). Nothing is saved until the owner saves.
 */
function firstDraft(capacity: number) {
  const count = Math.min(Math.max(capacity, 1), 144);
  const cols = Math.min(12, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const spots: Spot[] = Array.from({ length: count }, (_, index) => ({
    label: String(index + 1),
    row: Math.floor(index / cols),
    col: index % cols,
    kind: "reformer",
    status: "active",
  }));
  return { rows, cols, spots };
}

/**
 * The room's floor (docs/33 section 3.2): rows and columns as the room is drawn, the spots in their cells, the window
 * and the mirror. A tap on an empty cell adds a spot; a tap on a spot sends it to maintenance, and another tap takes it
 * out. Saving replaces the whole layout; a spot keeps its bookings as long as it stays.
 */
export function RoomLayoutDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const layout = useRoomLayout(room.id);
  return (
    <Dialog open onClose={onClose} title={`מפת החדר · ${room.name}`}>
      {layout.isError ? (
        <Banner tone="danger" icon="info">
          {errorMessage(layout.error, "לא הצלחנו לטעון את מפת החדר. נסו שוב.")}
        </Banner>
      ) : !layout.data ? (
        <Skeleton height={320} />
      ) : (
        <Editor room={room} layout={layout.data} onClose={onClose} />
      )}
    </Dialog>
  );
}

function Editor({ room, layout, onClose }: { room: Room; layout: RoomLayout; onClose: () => void }) {
  const toast = useToast();
  const save = useSaveRoomLayout(room.id);
  const [draft] = useState(() =>
    layout.rows == null && layout.spots.length === 0 ? firstDraft(room.defaultCapacity) : null,
  );
  const [spotSelection, setSpotSelection] = useState(draft ? true : layout.spotSelection);
  const [rows, setRows] = useState(draft?.rows ?? layout.rows ?? 3);
  const [cols, setCols] = useState(draft?.cols ?? layout.cols ?? 4);
  const [windowSide, setWindowSide] = useState<WindowSide>(layout.windowSide ?? null);
  const [mirrorFront, setMirrorFront] = useState(layout.mirrorFront);
  const [kind, setKind] = useState<Kind>(layout.spots[0]?.kind ?? "reformer");
  const [spots, setSpots] = useState<Spot[]>(
    () =>
      draft?.spots ??
      layout.spots.map(({ id, label, row, col, kind, status }) => ({ id, label, row, col, kind, status })),
  );

  const inside = spots.filter((spot) => spot.row < rows && spot.col < cols);
  const cut = spots.length - inside.length;
  const at = (row: number, col: number) => inside.find((spot) => spot.row === row && spot.col === col);

  const nextLabel = () => {
    const used = new Set(spots.map((spot) => spot.label));
    let n = 1;
    while (used.has(String(n))) n++;
    return String(n);
  };

  const tap = (row: number, col: number) => {
    const spot = at(row, col);
    if (!spot) setSpots([...spots, { label: nextLabel(), row, col, kind, status: "active" }]);
    else if (spot.status !== "maintenance")
      setSpots(spots.map((item) => (item === spot ? { ...item, status: "maintenance" } : item)));
    else setSpots(spots.filter((item) => item !== spot));
  };

  /** Numbers the spots 1, 2, 3… row by row from the front, in the reading direction. */
  const renumber = () => {
    const ordered = [...inside].sort((a, b) => a.row - b.row || a.col - b.col);
    setSpots(ordered.map((spot, index) => ({ ...spot, label: String(index + 1) })));
  };

  const submit = () =>
    save.mutate(
      { spotSelection, rows, cols, windowSide, mirrorFront, spots: inside },
      {
        onSuccess: () => {
          toast.show({ tone: "success", icon: "check", message: "מפת החדר נשמרה" });
          onClose();
        },
      },
    );

  const active = inside.filter((spot) => spot.status !== "maintenance").length;
  const style = { "--tp-cols": cols } as CSSProperties;

  return (
    <div className="tp-stack">
      <Checkbox
        label="המתאמנים בוחרים מכשיר כשהם נרשמים"
        checked={spotSelection}
        onChange={(event) => setSpotSelection(event.target.checked)}
      />
      <div className="tp-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        <Field label="שורות">
          <Select value={rows} onChange={(event) => setRows(Number(event.target.value))}>
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="טורים">
          <Select value={cols} onChange={(event) => setCols(Number(event.target.value))}>
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="מכשיר חדש">
          <Select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
            {kinds.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="חלון">
          <Select
            value={windowSide ?? ""}
            onChange={(event) => setWindowSide((event.target.value || null) as WindowSide)}
          >
            <option value="">אין</option>
            <option value="start">מימין</option>
            <option value="end">משמאל</option>
            <option value="back">מאחור</option>
          </Select>
        </Field>
      </div>
      <Checkbox
        label="קיר מראות מקדימה"
        checked={mirrorFront}
        onChange={(event) => setMirrorFront(event.target.checked)}
      />

      <div className="tp-room">
        {windowSide === "start" && <div className="tp-room__light" aria-hidden="true" />}
        {windowSide === "end" && <div className="tp-room__light tp-room__light--end" aria-hidden="true" />}
        {mirrorFront && <div className="tp-room__mirror" aria-hidden="true" />}
        <div className="tp-room__front">
          <span>{windowSide === "start" ? "חלון" : null}</span>
          <span className="tp-chip tp-chip--plain">מקדימה: המדריך.ה</span>
          <span>{windowSide === "end" ? "חלון" : null}</span>
        </div>
        <div className="tp-room__grid" style={style} role="group" aria-label="משבצות החדר">
          {Array.from({ length: rows * cols }, (_, index) => {
            const row = Math.floor(index / cols);
            const col = index % cols;
            const spot = at(row, col);
            const label = spot
              ? `מכשיר ${spot.label}${spot.status === "maintenance" ? ", בתחזוקה. הקשה מסירה אותו" : ". הקשה מעבירה לתחזוקה"}`
              : `משבצת ריקה, שורה ${row + 1} טור ${col + 1}. הקשה מוסיפה מכשיר`;
            return (
              <div key={index} style={{ gridRow: row + 1, gridColumn: col + 1, minWidth: 0 }}>
                <button
                  type="button"
                  className={`tp-spot${!spot ? " tp-spot--waiting" : spot.status === "maintenance" ? " tp-spot--maintenance" : ""}`}
                  aria-label={label}
                  onClick={() => tap(row, col)}
                >
                  {!spot ? (
                    <span className="tp-spot__who" style={{ display: "grid", placeItems: "center", opacity: 0.5 }}>
                      <Icon name="plus" />
                    </span>
                  ) : spot.status === "maintenance" ? (
                    <span className="tp-spot__who" style={{ display: "grid", placeItems: "center" }}>
                      <Icon name="wrench" />
                    </span>
                  ) : (
                    <>
                      <span className="tp-spot__rail" />
                      <span className="tp-spot__head" />
                      <span className="tp-spot__carriage" />
                      <span className="tp-spot__bar" />
                    </>
                  )}
                  {spot && <span className="tp-spot__label">{spot.label}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <p className="tp-caption tp-num">
        {active} מכשירים פעילים
        {inside.length > active && ` · ${inside.length - active} בתחזוקה`}
        {room.defaultCapacity > active && ` · בחדר יש ${room.defaultCapacity} מקומות, יותר מהמכשירים הפעילים`}
      </p>
      {cut > 0 && (
        <Banner tone="warning" icon="info">
          {cut === 1 ? "מכשיר אחד נמצא מחוץ לשורות ולטורים" : `${cut} מכשירים נמצאים מחוץ לשורות ולטורים`}, והם יוסרו
          בשמירה.
        </Banner>
      )}
      {save.isError && (
        <Banner tone="danger" icon="info">
          {errorMessage(save.error, "לא הצלחנו לשמור את מפת החדר. נסו שוב.")}
        </Banner>
      )}
      <div className="tp-row" style={{ justifyContent: "space-between" }}>
        <Button variant="ghost" onClick={renumber} disabled={inside.length === 0}>
          מספור מחדש
        </Button>
        <span className="tp-row" style={{ gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            שמירה
          </Button>
        </span>
      </div>
    </div>
  );
}

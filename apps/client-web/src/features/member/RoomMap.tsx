import type { CSSProperties } from "react";
import { Avatar, Icon, initials } from "../../shared/design-system";
import type { SessionSpot, SessionSpots } from "./experience";

export interface RoomMapProps {
  map: SessionSpots;
  /** The spot the member is choosing; null before they choose. */
  selectedId: string | null;
  onSelect: (spot: SessionSpot) => void;
  instructorName?: string;
  instructorPhoto?: string | null;
}

const stateText: Record<SessionSpot["state"], string> = {
  free: "פנוי",
  taken: "תפוס",
  mine: "המקום שלך",
  buddy: "תפוס",
  maintenance: "בתחזוקה",
};

/**
 * The room seen from above (docs/33 section 3, P3): the mirror wall and the instructor at the front, light from the
 * window, and the spots in their cells. Free spots are buttons; a taken spot says nothing about who holds it, except
 * a buddy's (D18).
 */
export function RoomMap({ map, selectedId, onSelect, instructorName, instructorPhoto }: RoomMapProps) {
  const style = { "--tp-cols": map.cols ?? 5 } as CSSProperties;
  return (
    <div className="tp-room">
      {map.windowSide === "start" && <div className="tp-room__light" aria-hidden="true" />}
      {map.windowSide === "end" && <div className="tp-room__light tp-room__light--end" aria-hidden="true" />}
      {map.mirrorFront && <div className="tp-room__mirror" aria-hidden="true" />}
      <div className="tp-room__front">
        <span>{map.windowSide === "start" ? <WindowLabel /> : null}</span>
        {instructorName ? (
          <span className="tp-chip tp-chip--plain">
            <Avatar name={instructorName} src={instructorPhoto ?? undefined} size="sm" />
            <bdi>{instructorName}</bdi>, הדרכה
          </span>
        ) : (
          <span />
        )}
        <span>{map.windowSide === "end" ? <WindowLabel /> : map.mirrorFront ? "קיר מראות" : null}</span>
      </div>
      <div className="tp-room__grid" style={style} role="group" aria-label="המכשירים בחדר">
        {map.spots.map((spot) => (
          <SpotTile
            key={spot.id}
            spot={spot}
            selected={spot.id === selectedId}
            usual={spot.id === map.usualSpotId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function WindowLabel() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Icon name="window" width={13} height={13} />
      חלון
    </span>
  );
}

function SpotTile({
  spot,
  selected,
  usual,
  onSelect,
}: {
  spot: SessionSpot;
  selected: boolean;
  usual: boolean;
  onSelect: (spot: SessionSpot) => void;
}) {
  const choosable = spot.state === "free" || spot.state === "mine";
  const className = [
    "tp-spot",
    spot.state === "taken" && "tp-spot--taken",
    spot.state === "buddy" && "tp-spot--buddy",
    spot.state === "maintenance" && "tp-spot--maintenance",
  ]
    .filter(Boolean)
    .join(" ");
  const buddy = spot.state === "buddy" ? spot.person : null;
  const label = `${spot.kind === "reformer" ? "מכשיר" : "מקום"} ${spot.label}, ${buddy ? `${buddy.displayName} כאן` : stateText[spot.state]}${usual ? ", המקום הקבוע שלך" : ""}`;
  return (
    <div style={{ gridRow: spot.row + 1, gridColumn: spot.col + 1, minWidth: 0 }}>
      <button
        type="button"
        className={className}
        aria-pressed={selected}
        aria-label={label}
        disabled={!choosable}
        onClick={() => onSelect(spot)}
      >
        {spot.state === "maintenance" ? (
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
        {buddy && (
          <span className="tp-spot__who tp-avatar" style={{ boxShadow: "0 0 0 2px var(--rose)" }}>
            {buddy.avatarUrl ? <img src={buddy.avatarUrl} alt="" /> : initials(buddy.displayName)}
          </span>
        )}
        {usual && (
          <span className="tp-spot__mark tp-spot__mark--usual">
            <Icon name="star" />
          </span>
        )}
        <span className="tp-spot__label">{spot.label}</span>
      </button>
    </div>
  );
}

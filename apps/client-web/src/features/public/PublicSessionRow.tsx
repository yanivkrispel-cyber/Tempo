import { Chip, ClassRow, TimeSlot } from "../../shared/design-system";
import { clockTime } from "../member/studioTime";
import type { PublicSession } from "./publicStudio";
import { availabilityChip, eventMark } from "./publicText";

/** One public class in a list, linking to its own page. */
export function PublicSessionRow({
  session,
  timeZone,
  now,
  day,
}: {
  session: PublicSession;
  timeZone: string;
  now: Date;
  /** The day under the time, in a list across days ("מחר"); else the length. */
  day?: string;
}) {
  const chip = availabilityChip(session, now, true);
  return (
    <ClassRow
      as="li"
      to={`/c/${session.id}`}
      slot={<TimeSlot time={clockTime(session.startsAt, timeZone)}>{day ?? `${session.minutes} דק׳`}</TimeSlot>}
      title={session.event?.title ?? session.classType.name}
      meta={[session.event && eventMark(session.event), session.instructor?.displayName, session.roomName]
        .filter(Boolean)
        .join(" · ")}
      actions={
        chip && (
          <Chip tone={chip.tone} plain={chip.tone === "neutral"}>
            {chip.label}
          </Chip>
        )
      }
    />
  );
}

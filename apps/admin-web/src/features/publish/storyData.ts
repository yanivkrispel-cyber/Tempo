import type { Schemas } from "@tempo/api-client";
import { addDays, dateIn, type IsoDate } from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";

type Session = Schemas["Session"];

/** The four stage A templates (docs/37 section 7.2); the id is what the link records. */
export type TemplateId = "week" | "today" | "spot_opened" | "change";

export const templates: readonly { id: TemplateId; name: string; caption: string }[] = [
  { id: "week", name: "השבוע בסטודיו", caption: "המערכת של השבוע עם התפוסה" },
  { id: "today", name: "מקומות אחרונים", caption: "השיעורים של היום שכמעט מלאים" },
  { id: "spot_opened", name: "התפנה מקום", caption: "שיעור אחד שיש בו מקום פנוי" },
  { id: "change", name: "שינוי במערכת", caption: "ביטולים בשבוע הקרוב" },
];

const weekdays = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;
const months = [
  "בינואר",
  "בפברואר",
  "במרץ",
  "באפריל",
  "במאי",
  "ביוני",
  "ביולי",
  "באוגוסט",
  "בספטמבר",
  "באוקטובר",
  "בנובמבר",
  "בדצמבר",
] as const;

export type LabelTone = "open" | "last" | "full" | "cancel";

/** One class as a story draws it: everything already in the studio's clock and in Hebrew. */
export interface StorySlot {
  id: string;
  date: IsoDate;
  weekday: string;
  time: string;
  name: string;
  /** Only an instructor who agreed to be shown publicly (M-14), and only when the owner shows instructors. */
  instructor: string | null;
  booked: number;
  capacity: number;
  free: number;
  cancelled: boolean;
  label: { tone: LabelTone; text: string } | null;
}

/**
 * The story's label for a class (M-11): "מקומות אחרונים" from 75% booked, "מלא · רשימת המתנה" at capacity, "בוטל"
 * for a cancelled one; below 75% nothing, or the places left when the owner asks for them.
 */
export function storyLabel(
  session: Pick<Session, "bookedCount" | "capacity" | "status">,
  showLeft: boolean,
): StorySlot["label"] {
  if (session.status === "cancelled") return { tone: "cancel", text: "בוטל" };
  if (session.bookedCount >= session.capacity) return { tone: "full", text: "מלא · רשימת המתנה" };
  if (session.capacity > 0 && session.bookedCount / session.capacity >= 0.75) {
    return { tone: "last", text: "מקומות אחרונים" };
  }
  if (!showLeft) return null;
  const left = session.capacity - session.bookedCount;
  return { tone: "open", text: left === 1 ? "נשאר מקום אחד" : `נשארו ${left} מקומות` };
}

export function toSlot(
  session: Session,
  timeZone: string,
  options: { showLeft: boolean; publicInstructors: ReadonlySet<string> | null },
): StorySlot {
  const date = dateIn(session.startsAt, timeZone);
  const instructor = session.instructor;
  return {
    id: session.id,
    date,
    weekday: weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()]!,
    time: clockTime(session.startsAt, timeZone),
    name: session.classType.name,
    instructor: instructor && options.publicInstructors?.has(instructor.membershipId) ? instructor.displayName : null,
    booked: session.bookedCount,
    capacity: session.capacity,
    free: Math.max(0, session.capacity - session.bookedCount),
    cancelled: session.status === "cancelled",
    label: storyLabel(session, options.showLeft),
  };
}

/** "20 עד 26 באוקטובר", or "28 בספטמבר עד 4 באוקטובר" across a month. */
export function weekRange(from: IsoDate): string {
  const to = addDays(from, 6);
  const [, fromMonth, fromDay] = from.split("-").map(Number) as [number, number, number];
  const [, toMonth, toDay] = to.split("-").map(Number) as [number, number, number];
  return fromMonth === toMonth
    ? `${fromDay} עד ${toDay} ${months[toMonth - 1]}`
    : `${fromDay} ${months[fromMonth - 1]} עד ${toDay} ${months[toMonth - 1]}`;
}

/** "היום", "מחר" or "ביום שלישי": how a story says when, from the studio's today. */
export function whenWord(slot: Pick<StorySlot, "date" | "weekday">, today: IsoDate): string {
  if (slot.date === today) return "היום";
  if (slot.date === addDays(today, 1)) return "מחר";
  return `ביום ${slot.weekday}`;
}

/** Which classes a template offers, before the owner hides any, and which of them start shown. */
export function candidates(template: TemplateId, slots: readonly StorySlot[], now: { today: IsoDate; time: string }) {
  const upcoming = slots.filter((slot) => slot.date > now.today || (slot.date === now.today && slot.time > now.time));
  switch (template) {
    case "week":
      return { offered: slots, shown: slots.slice(0, maxSlots.week).map((slot) => slot.id) };
    case "today": {
      const today = upcoming.filter((slot) => slot.date === now.today && !slot.cancelled);
      // The trigger's band (docs/37 section 7.2): 60% to 100% booked.
      const busy = today.filter((slot) => slot.capacity > 0 && slot.booked / slot.capacity >= 0.6);
      return { offered: today, shown: busy.slice(0, maxSlots.today).map((slot) => slot.id) };
    }
    case "spot_opened": {
      const open = upcoming.filter((slot) => !slot.cancelled && slot.free > 0);
      return { offered: open, shown: open.slice(0, 1).map((slot) => slot.id) };
    }
    case "change": {
      const cancelled = upcoming.filter((slot) => slot.cancelled);
      return { offered: cancelled, shown: cancelled.slice(0, maxSlots.change).map((slot) => slot.id) };
    }
  }
}

/** How many classes fit each design. */
export const maxSlots: Record<TemplateId, number> = { week: 9, today: 5, spot_opened: 1, change: 4 };

/** The same story as plain Hebrew text for WhatsApp (docs/37 section 7.3), with the link last. */
export function whatsappText(
  template: TemplateId,
  studioName: string,
  slots: readonly StorySlot[],
  link: string,
  today: IsoDate,
): string {
  const line = (slot: StorySlot, withDay: boolean) =>
    [
      withDay ? `${slot.weekday} ${slot.time}` : slot.time,
      slot.name,
      slot.instructor,
      template === "today" && !slot.label ? (slot.free === 1 ? "נשאר מקום אחד" : `נשארו ${slot.free} מקומות`) : null,
      slot.label?.text,
    ]
      .filter(Boolean)
      .join(" · ");
  switch (template) {
    case "week":
      return [`המערכת של השבוע ב${studioName}`, ...slots.map((slot) => line(slot, true)), "", `להרשמה: ${link}`].join(
        "\n",
      );
    case "today":
      return [
        `מקומות אחרונים היום ב${studioName}`,
        ...slots.map((slot) => line(slot, false)),
        "",
        `להרשמה: ${link}`,
      ].join("\n");
    case "spot_opened": {
      const slot = slots[0];
      if (!slot) return link;
      const places = slot.free === 1 ? "התפנה מקום" : `התפנו ${slot.free} מקומות`;
      const who = slot.instructor ? ` עם ${slot.instructor}` : "";
      return `${places} ב${slot.name}${who}, ${whenWord(slot, today)} ב-${slot.time}.\nמי שנרשמת ראשונה מקבלת: ${link}`;
    }
    case "change":
      return [
        `עדכון במערכת של ${studioName}`,
        ...slots.map((slot) => line(slot, true)),
        "",
        `המערכת המעודכנת: ${link}`,
      ].join("\n");
  }
}

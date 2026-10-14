// Sample data for the member screens until the studio API exists (Phase 2). Shaped like the
// mockup (docs/design/mockups/studio-2026-10-13, App*.dc.html) and dated from today, so the
// screens always show a live week. Names, rooms and the plan are invented placeholders.
import type { ClassColor } from "../../shared/design-system";
import { addDays, dayOfWeek, type IsoDate } from "../../shared/utilities/dates";
import type { Time } from "../../shared/utilities/times";

export type ClassKind = "pilates" | "yoga";

export interface StudioClass {
  id: string;
  date: IsoDate;
  start: Time;
  minutes: number;
  title: string;
  kind: ClassKind;
  color: ClassColor;
  coach: string;
  room: string;
  booked: number;
  capacity: number;
  waiting: number;
}

export interface Booking {
  classId: string;
  status: "booked" | "waiting";
  /** Place on the waiting list. */
  position?: number;
}

export interface PastVisit {
  id: string;
  title: string;
  date: IsoDate;
  status: "attended" | "cancelled";
}

export interface MemberProfile {
  name: string;
  email: string;
  studio: { name: string; tagline: string };
  plan: { name: string; renewsOn: IsoDate; card: string; periodDays: number; daysLeft: number };
  visitsThisMonth: number;
  monthlyGoal: number;
  streakWeeks: number;
  healthDeclarationSigned: boolean;
}

const classTypes = {
  vinyasa: { title: "ויניאסה יוגה", kind: "yoga", color: "sage", room: "האולם הגדול", minutes: 60 },
  reformer: { title: "פילאטיס מכשירים", kind: "pilates", color: "rose", room: "חדר המכשירים", minutes: 50 },
  mat: { title: "פילאטיס מזרן", kind: "pilates", color: "taupe", room: "האולם הגדול", minutes: 45 },
  power: { title: "פילאטיס כוח", kind: "pilates", color: "amber", room: "האולם הגדול", minutes: 45 },
  prenatal: { title: "יוגה בהריון", kind: "yoga", color: "mauve", room: "החדר הקטן", minutes: 60 },
  yin: { title: "יין יוגה ונשימה", kind: "yoga", color: "blue", room: "החדר הקטן", minutes: 75 }
} as const satisfies Record<string, { title: string; kind: ClassKind; color: ClassColor; room: string; minutes: number }>;

type Plan = Array<[start: Time, type: keyof typeof classTypes, coach: string, booked: number, capacity: number, waiting: number]>;

// Four day plans from the mockup, repeated through the week. The studio is closed on Saturday.
const dayPlans: Plan[] = [
  [
    ["17:30", "reformer", "דנה", 8, 8, 0],
    ["19:00", "prenatal", "נועה", 6, 10, 0],
    ["20:15", "yin", "עומר", 14, 14, 1]
  ],
  [
    ["07:00", "reformer", "דנה", 6, 8, 0],
    ["09:30", "vinyasa", "נועה", 8, 14, 0],
    ["18:00", "power", "עומר", 10, 10, 1],
    ["19:30", "mat", "יעל", 4, 12, 0]
  ],
  [
    ["07:00", "vinyasa", "נועה", 5, 14, 0],
    ["09:30", "reformer", "דנה", 3, 8, 0],
    ["18:30", "reformer", "דנה", 2, 8, 0],
    ["20:00", "yin", "עומר", 6, 14, 0]
  ],
  [
    ["08:00", "reformer", "דנה", 8, 8, 3],
    ["09:30", "vinyasa", "נועה", 11, 14, 0]
  ]
];

/** The classes from `today` through the next six days. */
export function sampleClasses(today: IsoDate): StudioClass[] {
  return Array.from({ length: 7 }, (_, offset) => addDays(today, offset)).flatMap((date, offset) =>
    dayOfWeek(date) === 6
      ? []
      : (dayPlans[offset % dayPlans.length] ?? []).map(([start, type, coach, booked, capacity, waiting]) => ({
          id: `${date}-${start}`,
          date,
          start,
          coach,
          booked,
          capacity,
          waiting,
          ...classTypes[type]
        }))
  );
}

/** As in the mockup: the first reformer class booked, a full power class waited on, a vinyasa class booked. */
function sampleBookings(classes: StudioClass[]): Booking[] {
  const reformer = classes.find((item) => item.title === classTypes.reformer.title);
  const power = classes.find((item) => item.title === classTypes.power.title && item.booked >= item.capacity);
  const vinyasa = classes.find((item) => item.title === classTypes.vinyasa.title && (!power || item.date > power.date));
  return [
    ...(reformer ? [{ classId: reformer.id, status: "booked" as const }] : []),
    ...(power ? [{ classId: power.id, status: "waiting" as const, position: power.waiting + 1 }] : []),
    ...(vinyasa ? [{ classId: vinyasa.id, status: "booked" as const }] : [])
  ];
}

function sampleHistory(today: IsoDate): PastVisit[] {
  const visits: Array<[number, keyof typeof classTypes, PastVisit["status"]]> = [
    [1, "reformer", "attended"],
    [2, "yin", "attended"],
    [5, "vinyasa", "attended"],
    [7, "reformer", "cancelled"],
    [8, "mat", "attended"],
    [12, "reformer", "attended"]
  ];
  return visits.map(([daysAgo, type, status]) => ({
    id: `past-${daysAgo}`,
    title: classTypes[type].title,
    date: addDays(today, -daysAgo),
    status
  }));
}

function sampleProfile(today: IsoDate): MemberProfile {
  return {
    name: "נגה רוזן",
    email: "noga.rosen@example.com",
    studio: { name: "סטודיו נשימה", tagline: "פילאטיס ויוגה · תל אביב" },
    plan: { name: "חודשי ללא הגבלה", renewsOn: addDays(today, 5), card: "4412", periodDays: 30, daysLeft: 5 },
    visitsThisMonth: 14,
    monthlyGoal: 18,
    streakWeeks: 6,
    healthDeclarationSigned: true
  };
}

export class SampleError extends Error {
  constructor(readonly code: "class.full" | "class.not_found" | "booking.exists") {
    super(code);
    this.name = "SampleError";
  }
}

/** An in-memory stand-in for the studio API: async like the real one, so the screens use TanStack Query today. */
export function createSampleApi(today: IsoDate) {
  const classes = sampleClasses(today);
  let bookings = sampleBookings(classes);
  for (const booking of bookings) {
    const item = classes.find((candidate) => candidate.id === booking.classId);
    if (item && booking.status === "waiting") item.waiting += 1;
  }

  const find = (classId: string) => {
    const item = classes.find((candidate) => candidate.id === classId);
    if (!item) throw new SampleError("class.not_found");
    if (bookings.some((booking) => booking.classId === classId)) throw new SampleError("booking.exists");
    return item;
  };

  return {
    today,
    classes: async (): Promise<StudioClass[]> => classes.map((item) => ({ ...item })),
    bookings: async (): Promise<Booking[]> => bookings.map((booking) => ({ ...booking })),
    history: async (): Promise<PastVisit[]> => sampleHistory(today),
    profile: async (): Promise<MemberProfile> => sampleProfile(today),
    book: async (classId: string): Promise<void> => {
      const item = find(classId);
      if (item.booked >= item.capacity) throw new SampleError("class.full");
      item.booked += 1;
      bookings = [...bookings, { classId, status: "booked" }];
    },
    joinWaitlist: async (classId: string): Promise<number> => {
      const item = find(classId);
      item.waiting += 1;
      bookings = [...bookings, { classId, status: "waiting", position: item.waiting }];
      return item.waiting;
    }
  };
}

export type SampleApi = ReturnType<typeof createSampleApi>;

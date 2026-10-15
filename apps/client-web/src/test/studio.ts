// A small in-memory studio behind the API stub: the timetable, bookings, the waitlist, passes and the inbox, with
// the server's rules that the member screens show (docs/29 sections 5 and 6). Times are fixed around `testNow`.
import type { Schemas } from "@tempo/api-client";
import { json, problem, sampleMe, signedInRoutes } from "./api";

type Session = Schemas["Session"];
type Booking = Schemas["Booking"];
type MyBooking = Schemas["MyBooking"];
type Pass = Schemas["Pass"];
type InboxItem = Schemas["InboxItem"];

/** Tuesday 13 October 2026, 12:00 in Tel Aviv (UTC+3 until the last Sunday of October). */
export const testNow = new Date("2026-10-13T09:00:00Z");
export const testToday = "2026-10-13";

export const organizationId = sampleMe.memberships[0]!.organization.id;
const base = `/api/v1/organizations/${organizationId}`;
const person = { id: "0199e5a1-0000-7000-8000-000000000801", displayName: "נגה רוזן" };

const classTypes = {
  reformer: { id: "0199e5a1-0000-7000-8000-000000000601", name: "פילאטיס מכשירים", category: "pilates", color: "rose" },
  mat: { id: "0199e5a1-0000-7000-8000-000000000602", name: "פילאטיס מזרן", category: "pilates", color: "taupe" },
  prenatal: { id: "0199e5a1-0000-7000-8000-000000000603", name: "יוגה בהריון", category: "yoga", color: "mauve" },
  yin: { id: "0199e5a1-0000-7000-8000-000000000604", name: "יין יוגה ונשימה", category: "yoga", color: "blue" },
  vinyasa: { id: "0199e5a1-0000-7000-8000-000000000605", name: "ויניאסה יוגה", category: "yoga", color: "sage" },
} as const;

const instructors = {
  dana: { membershipId: "0199e5a1-0000-7000-8000-000000000701", displayName: "דנה אלון" },
  noa: { membershipId: "0199e5a1-0000-7000-8000-000000000702", displayName: "נועה" },
  omer: { membershipId: "0199e5a1-0000-7000-8000-000000000703", displayName: "עומר" },
};

const rooms = {
  machines: { id: "0199e5a1-0000-7000-8000-000000000501", name: "חדר המכשירים" },
  hall: { id: "0199e5a1-0000-7000-8000-000000000502", name: "האולם הגדול" },
  small: { id: "0199e5a1-0000-7000-8000-000000000503", name: "החדר הקטן" },
};

export const card: Pass = {
  id: "0199e5a1-0000-7000-8000-000000000901",
  personId: person.id,
  product: {
    id: "0199e5a1-0000-7000-8000-000000000911",
    name: "כרטיסיית 10",
    kind: "punch_card",
    weeklyCap: null,
    classCategory: null,
  },
  startsOn: "2026-10-01",
  endsOn: "2026-12-31",
  entries: 10,
  entriesUsed: 3,
  entriesLeft: 7,
  note: null,
  status: "active",
  createdAt: "2026-10-01T08:00:00Z",
  version: "1",
  freezes: [],
};

export const defaultPolicy: Schemas["BookingPolicy"] = {
  freeCancelHours: 6,
  waitlistCutoffHours: 2,
  bookingHorizonDays: 14,
  waitlistEnabled: true,
  version: "1",
};

const hour = 3_600_000;
const id = (n: number) => `0199e5a1-0000-7000-8000-0000000003${String(n).padStart(2, "0")}`;
export const bookingIdOf = (sessionId: string) => sessionId.replace(/-0000000003/, "-0000000004");

function session(
  n: number,
  localDate: string,
  startsAt: string,
  minutes: number,
  type: keyof typeof classTypes,
  instructor: keyof typeof instructors,
  room: keyof typeof rooms,
  bookedCount: number,
  capacity: number,
  waitlistCount = 0,
): Session {
  const start = new Date(startsAt);
  return {
    id: id(n),
    templateId: null,
    localDate,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    classType: classTypes[type],
    instructor: instructors[instructor],
    room: rooms[room],
    capacity,
    bookedCount,
    waitlistCount,
    status: "scheduled",
    myBooking: null,
    passPreview: null,
    version: "1",
  };
}

export const sessionIds = {
  morning: id(1),
  reformer: id(2),
  mat: id(3),
  prenatal: id(4),
  yin: id(5),
  vinyasa: id(6),
  nextWeek: id(7),
};

export interface StudioOptions {
  /** The member's passes; a card with 7 entries left by default. */
  passes?: Pass[];
  inbox?: InboxItem[];
  policy?: Partial<Schemas["BookingPolicy"]>;
  /** History rows for `scope=past`. */
  past?: MyBooking[];
  /** The member's membership is frozen through this day: no pass preview, `Session.frozenUntil` set (A5). */
  frozenUntil?: string;
}

/** The studio's state and the stub routes that read and change it. */
export function createStudio(options: StudioOptions = {}) {
  const passes = options.passes ?? [structuredClone(card)];
  const sessions: Session[] = [
    // Already over: not shown.
    session(1, testToday, "2026-10-13T05:00:00Z", 50, "reformer", "dana", "machines", 4, 8),
    // Booked; the free window closed at 07:00 (it starts at 13:00).
    session(2, testToday, "2026-10-13T10:00:00Z", 50, "reformer", "dana", "machines", 8, 8),
    // Open; booking now is already past its free window (11:30).
    session(3, testToday, "2026-10-13T14:30:00Z", 45, "mat", "dana", "hall", 5, 12),
    // Open, free to cancel until 13:00.
    session(4, testToday, "2026-10-13T16:00:00Z", 60, "prenatal", "noa", "small", 6, 10),
    // Full, the waitlist is open.
    session(5, testToday, "2026-10-13T17:15:00Z", 75, "yin", "omer", "small", 14, 14, 1),
    // Booked tomorrow at 07:00, free to cancel until 01:00.
    session(6, "2026-10-14", "2026-10-14T04:00:00Z", 60, "vinyasa", "noa", "hall", 8, 14),
    session(7, "2026-10-21", "2026-10-21T15:00:00Z", 45, "mat", "dana", "hall", 2, 12),
  ];
  const bookings = new Map<string, Booking>();
  const inbox = options.inbox ?? [];
  const policy = { ...defaultPolicy, ...options.policy };

  const live = () => passes.find((pass) => pass.status === "active" && (pass.entriesLeft ?? 1) > 0);
  const summary = (pass: Pass): Schemas["PassSummary"] => ({
    id: pass.id,
    name: pass.product.name,
    kind: pass.product.kind,
    endsOn: pass.endsOn,
    entriesLeft: pass.entriesLeft,
  });
  const freeCancelUntil = (target: Session) =>
    new Date(new Date(target.startsAt).getTime() - policy.freeCancelHours * hour).toISOString();

  function place(target: Session, status: "booked" | "waitlisted", pass: Pass | null): Booking {
    const position = status === "waitlisted" ? target.waitlistCount : null;
    const booking: Booking = {
      id: bookingIdOf(target.id),
      sessionId: target.id,
      person,
      status,
      waitlistPosition: position,
      lateCancel: false,
      cancelReason: null,
      pass: pass ? summary(pass) : null,
      createdAt: testNow.toISOString(),
      version: "1",
    };
    bookings.set(booking.id, booking);
    target.myBooking = {
      bookingId: booking.id,
      status,
      waitlistPosition: position,
      freeCancelUntil: status === "booked" ? freeCancelUntil(target) : null,
    };
    return booking;
  }

  function takeEntry(): Pass | null {
    const pass = live();
    if (!pass) return null;
    if (pass.entriesLeft != null) {
      pass.entriesLeft -= 1;
      pass.entriesUsed += 1;
    }
    return pass;
  }

  // The member already holds a place in the reformer class today and the vinyasa class tomorrow.
  place(sessions[1]!, "booked", passes[0] ?? null);
  place(sessions[5]!, "booked", passes[0] ?? null);

  const view = (target: Session): Session => {
    const pass = options.frozenUntil ? undefined : live();
    return {
      ...target,
      passPreview: target.myBooking || target.status !== "scheduled" || !pass ? null : summary(pass),
      frozenUntil: options.frozenUntil ?? null,
    };
  };

  function book(target: Session): Response {
    if (target.myBooking) return problem(409, "booking.duplicate");
    if (!live()) return problem(409, "booking.no_valid_pass");
    if (target.bookedCount < target.capacity) {
      target.bookedCount += 1;
      return json(place(target, "booked", takeEntry()), 201);
    }
    const cutoff = new Date(target.startsAt).getTime() - policy.waitlistCutoffHours * hour;
    if (!policy.waitlistEnabled || testNow.getTime() >= cutoff) return problem(409, "session.full");
    target.waitlistCount += 1;
    return json(place(target, "waitlisted", null), 201);
  }

  function cancel(bookingId: string): Response {
    const booking = bookings.get(bookingId);
    const target = sessions.find((candidate) => candidate.myBooking?.bookingId === bookingId);
    if (!booking || !target) return problem(404, "booking.not_found");
    const late = booking.status === "booked" && testNow.getTime() > new Date(freeCancelUntil(target)).getTime();
    if (booking.status === "booked") {
      target.bookedCount -= 1;
      const pass = passes.find((candidate) => candidate.id === booking.pass?.id);
      if (pass && !late && pass.entriesLeft != null) {
        pass.entriesLeft += 1;
        pass.entriesUsed -= 1;
      }
    } else {
      target.waitlistCount -= 1;
    }
    target.myBooking = null;
    const result: Booking = {
      ...booking,
      status: "cancelled",
      lateCancel: late,
      cancelReason: "self",
      pass: late ? booking.pass : null,
      waitlistPosition: null,
    };
    bookings.set(bookingId, result);
    return json(result);
  }

  const mine = (scope: string | null): MyBooking[] => {
    if (scope === "past") return options.past ?? [];
    return [...bookings.values()]
      .filter((booking) => booking.status === "booked" || booking.status === "waitlisted")
      .map((booking) => ({ ...booking, session: view(sessions.find((target) => target.id === booking.sessionId)!) }))
      .filter((booking) => new Date(booking.session.startsAt).getTime() > testNow.getTime())
      .sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));
  };

  const routes: Record<string, unknown> = {
    ...signedInRoutes,
    [`GET ${base}`]: {
      id: organizationId,
      slug: "neshima",
      displayName: "סטודיו נשימה",
      status: "active",
      countryCode: "IL",
      defaultLocale: "he-IL",
      timeZone: "Asia/Jerusalem",
      currencyCode: "ILS",
      joinLinkEnabled: true,
      createdAt: "2026-10-01T08:00:00Z",
      version: "1",
    },
    [`GET ${base}/booking-policy`]: policy,
    [`GET ${base}/sessions`]: (request: Request) => {
      const url = new URL(request.url);
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "9999";
      return json({ items: sessions.filter((target) => target.localDate >= from && target.localDate <= to).map(view) });
    },
    [`GET ${base}/me/bookings`]: (request: Request) =>
      json({ items: mine(new URL(request.url).searchParams.get("scope")), nextBefore: null }),
    [`GET ${base}/me/passes`]: () => json({ items: passes }),
    [`GET ${base}/me/notifications`]: () =>
      json({ items: inbox, unreadCount: inbox.filter((item) => !item.readAt).length, nextBefore: null }),
  };
  for (const target of sessions) {
    routes[`GET ${base}/sessions/${target.id}`] = () => json(view(target));
    routes[`POST ${base}/sessions/${target.id}/bookings`] = () => book(target);
    routes[`POST ${base}/bookings/${bookingIdOf(target.id)}/cancel`] = () => cancel(bookingIdOf(target.id));
  }
  for (const item of inbox) {
    routes[`POST ${base}/me/notifications/${item.id}/read`] = () => {
      item.readAt = testNow.toISOString();
      return new Response(null, { status: 204 });
    };
  }

  return { routes, sessions, passes, inbox, bookings };
}

/** History rows on this morning's class, which has ended: attended, cancelled late, and cancelled by the studio. */
export function pastBookings(): MyBooking[] {
  const morning = session(1, testToday, "2026-10-13T05:00:00Z", 50, "reformer", "dana", "machines", 4, 8);
  const yesterday = session(8, "2026-10-12", "2026-10-12T15:00:00Z", 75, "yin", "omer", "small", 10, 14);
  const lastWeek = session(9, "2026-10-08", "2026-10-08T04:00:00Z", 60, "vinyasa", "noa", "hall", 9, 14);
  const row = (n: number, target: Session, extra: Partial<Booking>): MyBooking => ({
    id: `0199e5a1-0000-7000-8000-0000000004${80 + n}`,
    sessionId: target.id,
    person,
    status: "attended",
    waitlistPosition: null,
    lateCancel: false,
    cancelReason: null,
    pass: null,
    createdAt: "2026-10-01T08:00:00Z",
    version: "1",
    ...extra,
    session: target,
  });
  return [
    row(1, morning, { status: "attended" }),
    row(2, yesterday, { status: "cancelled", lateCancel: true, cancelReason: "self" }),
    row(3, lastWeek, { status: "cancelled", cancelReason: "session_cancelled" }),
  ];
}

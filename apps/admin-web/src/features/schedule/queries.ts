import { useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useApi } from "../../api/ApiProvider";
import { useStudio } from "../console/studio";

export type ClassType = Schemas["ClassType"];
export type ClassColor = Schemas["ClassColor"];
export type Room = Schemas["Room"];
export type ScheduleTemplate = Schemas["ScheduleTemplate"];
export type Session = Schemas["Session"];
export type BookingPolicy = Schemas["BookingPolicy"];
export type Member = Schemas["Member"];

/** Every scheduling query key starts with the studio, so switching studios never shows another studio's data. */
export const scheduleKeys = {
  all: (organizationId: string) => ["studio", organizationId, "schedule"] as const,
  classTypes: (organizationId: string) => ["studio", organizationId, "schedule", "class-types"] as const,
  rooms: (organizationId: string) => ["studio", organizationId, "schedule", "rooms"] as const,
  templates: (organizationId: string) => ["studio", organizationId, "schedule", "templates"] as const,
  session: (organizationId: string, sessionId: string) =>
    ["studio", organizationId, "schedule", "session", sessionId] as const,
  sessions: (organizationId: string, from?: string, to?: string) =>
    from === undefined
      ? (["studio", organizationId, "schedule", "sessions"] as const)
      : (["studio", organizationId, "schedule", "sessions", { from, to }] as const),
  policy: (organizationId: string) => ["studio", organizationId, "schedule", "policy"] as const,
  instructors: (organizationId: string) => ["studio", organizationId, "schedule", "instructors"] as const,
};

/** Studios in Israel only for now (settings offer one zone); the real value comes from the studio record. */
const fallbackTimeZone = "Asia/Jerusalem";

/** The studio's IANA time zone: sessions are shown and created on its clock, never the device's. */
export function useStudioTimeZone(): string {
  const api = useApi();
  const { organizationId } = useStudio();
  // Same key as the settings page, so they share one request.
  const organization = useQuery({
    queryKey: ["studio", organizationId, "organization"],
    queryFn: () => unwrap(api.GET("/api/v1/organizations/{organizationId}", { params: { path: { organizationId } } })),
  });
  return organization.data?.timeZone ?? fallbackTimeZone;
}

export function useClassTypes() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: scheduleKeys.classTypes(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/class-types", { params: { path: { organizationId } } }),
      ).then((list) => list.items),
  });
}

export function useRooms() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: scheduleKeys.rooms(organizationId),
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/rooms", { params: { path: { organizationId } } })).then(
        (list) => list.items,
      ),
  });
}

export function useTemplates() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: scheduleKeys.templates(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/schedule-templates", { params: { path: { organizationId } } }),
      ).then((list) => list.items),
  });
}

/** Sessions from `from` to `to`, both local dates in the studio's zone and inclusive. */
export function useSessions(from: string, to: string) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: scheduleKeys.sessions(organizationId, from, to),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/sessions", {
          params: { path: { organizationId }, query: { from, to } },
        }),
      ).then((list) => list.items),
  });
}

export function useSession(sessionId: string) {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: scheduleKeys.session(organizationId, sessionId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/sessions/{sessionId}", {
          params: { path: { organizationId, sessionId } },
        }),
      ),
  });
}

export function useBookingPolicy() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: scheduleKeys.policy(organizationId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/organizations/{organizationId}/booking-policy", { params: { path: { organizationId } } }),
      ),
  });
}

const teachingRoles = ["owner", "admin", "staff"] as const;

/**
 * Who can teach: active owners, admins and staff, the same rule the API checks (`instructor.invalid`). One request
 * per role, so a studio's many clients never push the team off the first page.
 */
export function useInstructors() {
  const api = useApi();
  const { organizationId } = useStudio();
  return useQuery({
    queryKey: scheduleKeys.instructors(organizationId),
    queryFn: async () => {
      const pages = await Promise.all(
        teachingRoles.map((role) =>
          unwrap(
            api.GET("/api/v1/organizations/{organizationId}/members", {
              params: { path: { organizationId }, query: { role, status: "active", limit: 100 } },
            }),
          ),
        ),
      );
      return pages.flatMap((page) => page.items).sort((a, b) => memberName(a).localeCompare(memberName(b), "he"));
    },
  });
}

export function memberName(member: Member): string {
  return member.displayName?.trim() || member.email.split("@")[0] || member.email;
}

export const colorLabels: Record<ClassColor, string> = {
  sage: "ירוק מרווה",
  rose: "ורוד עתיק",
  taupe: "חום אפרפר",
  amber: "ענבר",
  mauve: "סגול",
  blue: "כחול",
};

export const colors = Object.keys(colorLabels) as ClassColor[];

/** Categories studios use; the API takes lowercase English keys (`^[a-z][a-z0-9_]{1,29}$`). */
export const categoryLabels: Record<string, string> = {
  pilates: "פילאטיס",
  yoga: "יוגה",
  fitness: "כושר",
  dance: "מחול",
  other: "אחר",
};

export function categoryLabel(category: string): string {
  return categoryLabels[category] ?? category;
}

/** The known categories plus any the studio already uses. */
export function categoryOptions(inUse: readonly string[] = []): { value: string; label: string }[] {
  const keys = [...Object.keys(categoryLabels), ...inUse.filter((category) => !(category in categoryLabels))];
  return [...new Set(keys)].map((value) => ({ value, label: categoryLabel(value) }));
}

export const weekdayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

/** "50 דקות", "שעה", "שעה ורבע"… kept simple: minutes, as the mockup writes them. */
export function minutesLabel(minutes: number): string {
  return `${minutes} דקות`;
}

/** "17:30", the end of a class that starts at `start` and lasts `minutes`. */
export function endTime(start: string, minutes: number): string {
  const total = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** A whole number from a text field, or null. */
export function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** The tile's corner label, as the mockup writes it: "בוטל", "מלא · 2 בהמתנה", "מקום אחד", "3 פנויים". */
export function sessionBadge(session: Session): string {
  if (session.status === "cancelled") return "בוטל";
  const free = session.capacity - session.bookedCount;
  if (free <= 0) return session.waitlistCount > 0 ? `מלא · ${session.waitlistCount} בהמתנה` : "מלא";
  return free === 1 ? "מקום אחד" : `${free} פנויים`;
}

/** "6 מתוך 8 רשומים". */
export function occupancy(session: Session): string {
  return `${session.bookedCount} מתוך ${session.capacity} רשומים`;
}

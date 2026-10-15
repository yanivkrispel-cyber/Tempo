import type { Api } from "./api";

/**
 * Helpers for the SYNC 2 flow (specs/sync2): the studio's wall clock and the removal of everything the flow
 * creates. Only records whose name starts with `e2e-` are touched, never the demo studio's `דמו: ` data.
 */

const timeZone = "Asia/Jerusalem";

interface Parts {
  date: string;
  time: string;
}

/** The studio's local date (YYYY-MM-DD) and time (HH:mm) at an instant. */
export function studioParts(instant: Date): Parts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The studio's local date `days` after today (calendar days, so a daylight-saving change does not skip one). */
export function studioDay(days: number): string {
  const [year, month, day] = studioParts(new Date()).date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export interface SessionRow {
  id: string;
  templateId?: string | null;
  localDate: string;
  status: string;
  classType: { id: string; name: string };
}

/** Every session between two local dates. */
export async function sessionsBetween(api: Api, from: string, to: string): Promise<SessionRow[]> {
  return (await api.call<{ items: SessionRow[] }>("GET", "/sessions", { params: { from, to } })).items;
}

/** A one-off e2e session (staff API), for the steps that need a particular time. */
export async function createSession(
  api: Api,
  body: { classTypeId: string; roomId: string; localDate: string; localStart: string; capacity: number },
): Promise<string> {
  const created = await api.call<{ id: string }>("POST", "/sessions", { data: { minutes: 30, ...body } });
  return created.id;
}

/**
 * Removes everything named `e2e-` that the flow creates or leaves behind in an interrupted run: sessions are
 * cancelled (entries return, waiters leave), the smoke user's e2e passes voided, weekly classes ended, products,
 * rooms and class types archived. Safe to run when nothing is there.
 */
export async function removeE2eSchedule(api: Api, ownPersonId?: string): Promise<void> {
  const today = studioDay(0);
  const classTypes = (
    await api.call<{ items: { id: string; name: string; status: string }[] }>("GET", "/class-types")
  ).items.filter((item) => item.name.startsWith("e2e-"));
  const typeIds = new Set(classTypes.map((item) => item.id));

  const sessions = (await sessionsBetween(api, studioDay(0), studioDay(60))).filter(
    (session) => typeIds.has(session.classType.id) && session.status !== "cancelled",
  );
  for (const session of sessions) await api.call("POST", `/sessions/${session.id}/cancel`, { accept: [409] });

  if (ownPersonId) {
    const passes = await api.call<{ items: { id: string; status: string; product: { name: string } }[] }>(
      "GET",
      `/people/${ownPersonId}/passes`,
    );
    for (const pass of passes.items.filter(
      (item) => item.status === "active" && item.product.name.startsWith("e2e-"),
    )) {
      await api.call("POST", `/passes/${pass.id}/void`, { accept: [409] });
    }
  }

  const templates = (
    await api.call<{ items: { id: string; classTypeId: string; validUntil?: string | null }[] }>(
      "GET",
      "/schedule-templates",
    )
  ).items.filter((item) => typeIds.has(item.classTypeId) && !item.validUntil);
  for (const template of templates)
    await api.call("PATCH", `/schedule-templates/${template.id}`, { data: { validUntil: today } });

  const products = (await api.call<{ items: { id: string; name: string; status: string }[] }>("GET", "/pass-products"))
    .items;
  for (const product of products.filter((item) => item.name.startsWith("e2e-") && item.status === "active")) {
    await api.call("POST", `/pass-products/${product.id}/archive`, { accept: [409] });
  }
  const rooms = (await api.call<{ items: { id: string; name: string; status: string }[] }>("GET", "/rooms")).items;
  for (const room of rooms.filter((item) => item.name.startsWith("e2e-") && item.status === "active")) {
    await api.call("PATCH", `/rooms/${room.id}`, { data: { status: "archived" } });
  }
  for (const type of classTypes.filter((item) => item.status === "active")) {
    await api.call("PATCH", `/class-types/${type.id}`, { data: { status: "archived" } });
  }
}

/**
 * The booking plan of `demo-studio.mjs fill` (board #494, K3): makes a demo studio's coming week look lived in.
 * Only fictional people are booked, and only into classes that are upcoming, scheduled and still empty, so a run
 * never touches a real person or a booking someone made.
 */

/** A person seeded for a demo: the address is in the domain RFC 2606 reserves for examples. */
export function isFictional(person) {
  return typeof person?.primaryEmail === "string" && /@example\.com$/i.test(person.primaryEmail);
}

/**
 * @param {{ id: string, startsAt: string, capacity: number, bookedCount: number, status: string }[]} sessions
 * @param {string[]} personIds fictional people who hold an active pass
 * @param {string} now ISO time
 * @returns {{ sessionId: string, personIds: string[] }[]} the smallest class full with two waiting, the others
 *   about two thirds full; the people rotate so each gets a similar share
 */
export function planFill(sessions, personIds, now) {
  if (personIds.length === 0) return [];
  const open = sessions
    .filter((s) => s.status === "scheduled" && s.startsAt > now && s.bookedCount === 0 && s.capacity > 0)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (open.length === 0) return [];
  const full = open.reduce((smallest, s) => (s.capacity < smallest.capacity ? s : smallest), open[0]);

  let cursor = 0;
  const take = (count) => {
    const ids = [];
    for (let i = 0; i < Math.min(count, personIds.length); i += 1) {
      ids.push(personIds[cursor % personIds.length]);
      cursor += 1;
    }
    return ids;
  };
  return open.map((s) => ({
    sessionId: s.id,
    personIds: take(s === full ? s.capacity + 2 : Math.ceil((s.capacity * 2) / 3)),
  }));
}

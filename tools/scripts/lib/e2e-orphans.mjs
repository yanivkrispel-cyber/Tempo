// Account rows of e2e logins whose Cognito user is gone (#312, Q-3 of board #481). DELETE /me needs a sign-in, so
// these rows can't remove themselves; e2e-cleanup.mjs only lists them. A row is matched by its Cognito subjects
// (identity.external_identities), not by its address: a later run may reuse an address with a new Cognito user.

import { isE2eEmail } from "./e2e-names.mjs";

/** The e2e rows (`{ email, subjects, ... }`) none of whose subjects is in `liveSubjects`. */
export function findOrphans(rows, liveSubjects) {
  return rows.filter((row) => isE2eEmail(row.email) && !(row.subjects ?? []).some((subject) => liveSubjects.has(subject)));
}

/** The run an e2e address belongs to: `e2e-p2-owner-1a@example.com` → `e2e-p2`. */
function runOf(email) {
  return email.trim().toLowerCase().split("-").slice(0, 2).join("-");
}

/**
 * Counts for the board: orphans per run (most first), how many still hold a live membership, and the ones holding a
 * live place in a studio that isn't an e2e studio (those need a look before any delete).
 */
export function summarizeOrphans(orphans) {
  const counts = new Map();
  for (const orphan of orphans) counts.set(runOf(orphan.email), (counts.get(runOf(orphan.email)) ?? 0) + 1);
  const byRun = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    total: orphans.length,
    byRun,
    withLiveMemberships: orphans.filter((o) => o.liveMemberships > 0).length,
    outsideE2e: orphans.filter((o) => o.nonE2eMemberships > 0),
  };
}

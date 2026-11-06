// The pilot pulse (board #584, K5): one row per studio, counts only. Read-only SQL as the owner role; the output carries
// no name, email, phone or note, so it can be pasted into a board comment as it is.

/** Every column the query returns. A test checks that none of them can hold personal data. */
export const PULSE_COLUMNS = [
  "slug",
  "status",
  "created_on",
  "members",
  "staff",
  "people",
  "weekly_classes",
  "sessions_next_7",
  "bookings_7",
  "bookings_28",
  "attended_7",
  "attended_28",
  "passes_active",
  "last_staff_sign_in",
];

/**
 * $1 = include e2e studios (boolean). Windows are by the session's start: the last 7 and 28 days up to now.
 * "Bookings" are places taken (booked, attended or a no-show); "attended" is what staff marked. The last staff sign-in
 * is the newest `identity_synced_at` of an owner, admin or staff member, which the API moves forward on a fresh sign-in.
 */
export const PULSE_SQL = `
WITH studio AS (
  SELECT o.id, o.slug, o.status, o.created_at
  FROM organizations.organizations o
  WHERE $1::boolean OR o.slug NOT LIKE 'e2e-%'
)
SELECT
  s.slug,
  s.status,
  to_char(s.created_at, 'YYYY-MM-DD') AS created_on,
  (SELECT count(*) FROM organizations.memberships m WHERE m.organization_id = s.id AND m.status = 'active' AND m.role = 'client')::int AS members,
  (SELECT count(*) FROM organizations.memberships m WHERE m.organization_id = s.id AND m.status = 'active' AND m.role <> 'client')::int AS staff,
  (SELECT count(*) FROM people.people p WHERE p.organization_id = s.id AND p.status = 'active')::int AS people,
  (SELECT count(*) FROM scheduling.templates t WHERE t.organization_id = s.id AND (t.valid_until IS NULL OR t.valid_until >= current_date))::int AS weekly_classes,
  (SELECT count(*) FROM scheduling.sessions x WHERE x.organization_id = s.id AND x.status = 'scheduled'
     AND x.starts_at >= now() AND x.starts_at < now() + interval '7 days')::int AS sessions_next_7,
  (SELECT count(*) FROM scheduling.bookings b JOIN scheduling.sessions x ON x.organization_id = b.organization_id AND x.id = b.session_id
     WHERE b.organization_id = s.id AND b.status IN ('booked', 'attended', 'no_show')
       AND x.starts_at >= now() - interval '7 days' AND x.starts_at < now())::int AS bookings_7,
  (SELECT count(*) FROM scheduling.bookings b JOIN scheduling.sessions x ON x.organization_id = b.organization_id AND x.id = b.session_id
     WHERE b.organization_id = s.id AND b.status IN ('booked', 'attended', 'no_show')
       AND x.starts_at >= now() - interval '28 days' AND x.starts_at < now())::int AS bookings_28,
  (SELECT count(*) FROM scheduling.bookings b JOIN scheduling.sessions x ON x.organization_id = b.organization_id AND x.id = b.session_id
     WHERE b.organization_id = s.id AND b.status = 'attended'
       AND x.starts_at >= now() - interval '7 days' AND x.starts_at < now())::int AS attended_7,
  (SELECT count(*) FROM scheduling.bookings b JOIN scheduling.sessions x ON x.organization_id = b.organization_id AND x.id = b.session_id
     WHERE b.organization_id = s.id AND b.status = 'attended'
       AND x.starts_at >= now() - interval '28 days' AND x.starts_at < now())::int AS attended_28,
  (SELECT count(*) FROM scheduling.passes ps WHERE ps.organization_id = s.id AND ps.status = 'active' AND ps.ends_on >= current_date)::int AS passes_active,
  (SELECT to_char(max(a.identity_synced_at), 'YYYY-MM-DD') FROM organizations.memberships m JOIN identity.user_accounts a ON a.id = m.user_account_id
     WHERE m.organization_id = s.id AND m.status = 'active' AND m.role <> 'client') AS last_staff_sign_in
FROM studio s
ORDER BY s.created_at
`;

const HEADERS = {
  slug: "studio",
  status: "status",
  created_on: "since",
  members: "members",
  staff: "staff",
  people: "people",
  weekly_classes: "weekly",
  sessions_next_7: "next 7d",
  bookings_7: "booked 7d",
  bookings_28: "booked 28d",
  attended_7: "attended 7d",
  attended_28: "attended 28d",
  passes_active: "passes",
  last_staff_sign_in: "staff seen",
};

/** A Markdown table, one row per studio, in PULSE_COLUMNS order; anything else in a row is dropped. */
export function formatPulse(rows, now = new Date()) {
  const lines = [
    `Pilot pulse, ${now.toISOString().slice(0, 16).replace("T", " ")}Z, ${rows.length} ${rows.length === 1 ? "studio" : "studios"}`,
    "",
    `| ${PULSE_COLUMNS.map((c) => HEADERS[c]).join(" | ")} |`,
    `|${PULSE_COLUMNS.map((c) => (c === "slug" || c === "status" ? "---" : "---:")).join("|")}|`,
  ];
  for (const row of rows) {
    lines.push(`| ${PULSE_COLUMNS.map((c) => (row[c] === null || row[c] === undefined ? "—" : String(row[c]))).join(" | ")} |`);
  }
  return lines.join("\n");
}

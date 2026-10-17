# Reports and Removal LLD (owner reports, account and studio removal)

> **Status:** Decision for R-1 to R-6, A-1 to A-5 (Kris, 2026-10-17, day board #253, "APPROVED: the defaults apply
> as written"). Two readings of R-4 are this document's own and are marked **(reading)** in section 6; Kris can
> change them on the board.
> **Audience:** Kris, Ofir, the agents.
> **Related:** ADR-0021 ($0 until revenue), docs/27 (permissions, people, erase, export), docs/29 (sessions,
> bookings, passes), docs/31 section 12 (weeks run Sunday to Saturday, G-2), pilot-readiness.md (P2 F4, F6).

A studio owner today counts the week on paper: how many came, which classes fill, who is about to run out of a card,
who stopped coming. This document gives the console those answers from the tables Tempo already has, with no new
table and no job. It also closes the two pilot gaps from the P2 dry run: a person cannot delete their own login
(F6), and nobody can remove a studio (F4).

## 1. Scope

In:

- one new permission, `reports.view`, for `owner` and `admin` (R-1, migration 0021);
- a summary for a period of up to 92 days: per week, per class type and for the whole period, with the previous
  period of the same length for comparison (R-2, R-3);
- two lists with names: passes ending soon and members at risk (R-4), behind `reports.view` **and** `people.view`
  (R-6);
- `DELETE /api/v1/me`: a person deletes their own login (A-1, A-2);
- `DELETE /api/v1/platform/organizations/{id}`: the operator removes a suspended studio (A-3);
- the export with an unreadable health key (A-5) and the e2e cleanup script (A-4).

Out: revenue (no payments yet), instructor reports, CSV download, scheduled report emails (no SES, D-1), charts
beyond weeks, any figure from health data.

## 2. Decisions

| Id | Decision |
|---|---|
| R-1 | `reports.view` goes to the `owner` and `admin` system roles. `staff` and `client` don't get it; a custom role can. |
| R-2 | `from` and `to` are dates in the studio's time zone, both included, at most 92 days (a longer range is 400). The console defaults to the last 4 full weeks. Weeks run Sunday to Saturday (G-2). |
| R-3 | Per week and per class type: sessions held, places booked, attended, no-shows, late cancellations, fill rate (attended over capacity). For the period: the same, plus active members and new members. |
| R-4 | Passes ending soon (within 14 days, or one entry left) and members at risk (no attended class for 30 days, but a valid pass). 50 rows each at most, linked to the person card. |
| R-5 | Computed live with SQL under RLS. No new table, materialized view or job. An index only if `EXPLAIN` on 10 000 seeded bookings shows a sequential scan that hurts (section 8). |
| R-6 | Names only in the two lists, never health data. Reading a report is not audited. The lists need `people.view` too. |
| A-1 | `DELETE /api/v1/me` with a recent sign-in and the account's email typed; 409 `account.sole_owner` while the caller is the only owner of a studio. |
| A-2 | One transaction: memberships end, the account row goes, each person record is detached and kept. Then Cognito `AdminDeleteUser` on the one pool. Audit `account.deleted`, no email. |
| A-3 | Operator only, on a studio suspended for at least `StudioRemovalMinDays` (0 on dev, 30 on prod); the name typed and a recent sign-in; every tenant row in one transaction; audit `platform.organization.deleted` with id and name only. |
| A-4 | `tools/scripts/e2e-cleanup.mjs`: lists `e2e-…@example.com` logins and `e2e-…` studios; `--apply` deletes them through A-1 and A-3. |
| A-5 | When the health key can't be read, the export still answers 200 and its health part says `"withheld": "health_key_unavailable"`; a warning without content goes to the log. |

## 3. Permissions (migration 0021)

```sql
INSERT INTO authz.role_permissions (role_id, permission_key) VALUES
    ('00000000-0000-7000-8000-000000000001'::uuid, 'reports.view'),   -- owner
    ('00000000-0000-7000-8000-000000000002'::uuid, 'reports.view');   -- admin
```

`Permissions.ReportsView` joins the catalog ("See the studio's reports"), so `GET /permissions` lists it and custom
roles can carry it. `SystemRoles.Admin` gains it; the owner holds every key already.

| Route | Needs |
|---|---|
| `GET …/reports/summary` | `reports.view` |
| `GET …/reports/passes-ending` | `reports.view` and `people.view` |
| `GET …/reports/members-at-risk` | `reports.view` and `people.view` |

The route filter checks `reports.view`; the two list endpoints check `people.view` in the handler and answer 403
`permission.denied` without it. Both system roles that get `reports.view` hold `people.view`, so the second check
matters only for custom roles.

## 4. The period and the weeks

- `today` is the date now in the studio's time zone (`organizations.organizations.time_zone`).
- No `from` and no `to`: `to` is the Saturday before the current week and `from` the Sunday 27 days earlier.
- One of them alone, or `to` before `from`: 400 `report.period_invalid`. More than 92 days (`to - from + 1 > 92`):
  400 `report.period_too_long`. Dates in the future are allowed; nothing in them has been held yet.
- `previous` is the period of the same length ending the day before `from`.
- `weeks` lists every Sunday-to-Saturday week that overlaps the period, oldest first, with the part of the week
  inside the period as its own `from` and `to`. A week with nothing held is present with zeros and `fillRate: null`,
  so the chart has no gaps.
- A session belongs to the day of its `local_date` (its date in the studio's time zone, set when it is created), the
  same rule as member progress. A class at 23:30 on Saturday is in that week even when UTC is already Sunday.

## 5. The summary queries

Every query runs in the application role inside `UnitOfWork.BeginAsync(…, organizationId, …)`, which sets
`app.organization_id`. **RLS reasoning:** each table read here (`scheduling.sessions`, `scheduling.bookings`,
`scheduling.class_types`, `people.people`, `organizations.memberships`) has an `_app` policy
`organization_id = current_setting('app.organization_id')`, so a row of studio B cannot be returned while the request
is for studio A, whatever the SQL says. Each query also filters `organization_id = $1` itself: it lets the planner use
the `(organization_id, …)` indexes, and keeps the query correct if it is ever run by the platform role, whose policy
is `USING (true)`. The integration test seeds studio B and asserts its bookings never count in A (R2).

**Held sessions.** A session is *held* when `status = 'scheduled'` and `starts_at <= now()`. A cancelled session
offered nothing. A session that hasn't started has nothing to count yet.

**Figures per session**, the base of every other figure (`$2` = from, `$3` = to):

```sql
SELECT s.id, s.local_date, s.class_type_id, s.capacity,
       count(*) FILTER (WHERE b.status IN ('booked', 'attended', 'no_show'))       AS places_booked,
       count(*) FILTER (WHERE b.status = 'attended')                               AS attended,
       count(*) FILTER (WHERE b.status = 'no_show')                                AS no_show,
       count(*) FILTER (WHERE b.status = 'cancelled' AND b.late_cancel)            AS late_cancellations
FROM scheduling.sessions s
LEFT JOIN scheduling.bookings b ON b.organization_id = s.organization_id AND b.session_id = s.id
WHERE s.organization_id = $1 AND s.local_date BETWEEN $2 AND $3
  AND s.status = 'scheduled' AND s.starts_at <= now()
GROUP BY s.id;
```

The service folds these rows into weeks (by `Progress.WeekStart(local_date)`), class types and the total in C#, so
the three views can never disagree. 92 days of a busy studio is under 1 000 sessions: one round trip, small rows.

- `booked` still counts as a place: attendance may simply not be marked yet.
- `waitlisted`, `removed` and `expired` never held a place. A cancellation in the free window is not a figure.
- `fillRate = attended / capacity`, rounded to 3 places; `null` when `capacity` is 0 (nothing held).

**Class types.** The ids from the rows above, with `name` and `color` from `scheduling.class_types` (same RLS
policy); archived types still appear when they were held in the period. Ordered by `attended`, most first.

**Active members** (`$2`, `$3` as above):

```sql
SELECT count(DISTINCT b.person_id)
FROM scheduling.bookings b
JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
LEFT JOIN organizations.memberships m ON m.organization_id = p.organization_id AND m.id = p.membership_id
WHERE b.organization_id = $1 AND b.status = 'attended' AND s.local_date BETWEEN $2 AND $3
  AND (m.id IS NULL OR m.role = 'client');
```

An instructor who takes a class is staff, not a member, so active members use the same role filter as new members.

**New members** (`$4` = the studio's time zone id):

```sql
SELECT count(*)
FROM people.people p
LEFT JOIN organizations.memberships m ON m.organization_id = p.organization_id AND m.id = p.membership_id
WHERE p.organization_id = $1
  AND (p.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
  AND p.status <> 'merged'
  AND (m.id IS NULL OR m.role = 'client');
```

Merged duplicates would count one person twice, so they are left out. Records of staff (a membership with a role
other than `client`) are not members. An erased (`anonymized`) person still counts as new in the week they joined:
it is a number, not a name.

The `previous` period runs the same three queries with its own dates; that is six queries per summary.

## 6. The two lists

Both use `today` from section 4, 50 rows at most: the query takes 51 and `truncated` is true when the 51st comes
back. Only `people.status = 'active'` people appear; archived, erased and merged records never do. Each row carries
`personId` for the link to the person card (`/people/{personId}` in admin-web) and `displayName`, nothing else
about the person.

**Passes ending soon** (`$2` = today, `$3` = today + 14):

```sql
SELECT p.id, p.person_id, pe.display_name, pp.name, pp.kind, p.ends_on,
       CASE WHEN p.entries IS NULL THEN NULL ELSE p.entries - p.entries_used END AS entries_left
FROM scheduling.passes p
JOIN people.people pe ON pe.organization_id = p.organization_id AND pe.id = p.person_id
JOIN scheduling.pass_products pp ON pp.organization_id = p.organization_id AND pp.id = p.product_id
WHERE p.organization_id = $1 AND p.status = 'active' AND pe.status = 'active'
  AND p.starts_on <= $2 AND p.ends_on >= $2
  AND (p.entries IS NULL OR p.entries_used < p.entries)
  AND (p.ends_on <= $3 OR p.entries - p.entries_used = 1)
  AND NOT EXISTS (                                    -- (reading) already renewed
      SELECT 1 FROM scheduling.passes n
      WHERE n.organization_id = p.organization_id AND n.person_id = p.person_id AND n.id <> p.id
        AND n.status = 'active' AND n.ends_on > $3 AND (n.entries IS NULL OR n.entries_used < n.entries))
ORDER BY p.ends_on, p.id
LIMIT 51;
```

- A used-up card is not "ending": it has ended. A pass that hasn't started yet is not in the list.
- `reason` is `ends_soon` when `ends_on <= today + 14` (it wins when both hold), otherwise `last_entry`.
- **(reading)** A person who already holds another valid pass that runs past the 14 days has renewed; the owner has
  nobody to call, so the old pass is left out.

**Members at risk** (`$2` = today, `$3` = today − 30):

```sql
SELECT pe.id, pe.display_name,
       (SELECT max(s.local_date) FROM scheduling.bookings b
        JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
        WHERE b.organization_id = pe.organization_id AND b.person_id = pe.id
          AND b.status = 'attended' AND s.local_date <= $2)                        AS last_attended_on,
       max(p.ends_on)                                                              AS pass_ends_on
FROM people.people pe
JOIN scheduling.passes p ON p.organization_id = pe.organization_id AND p.person_id = pe.id
WHERE pe.organization_id = $1 AND pe.status = 'active'
  AND p.status = 'active' AND p.starts_on <= $2 AND p.ends_on >= $2
  AND (p.entries IS NULL OR p.entries_used < p.entries)
  AND NOT EXISTS (SELECT 1 FROM scheduling.pass_freezes f            -- frozen today: away on purpose
                  WHERE f.organization_id = p.organization_id AND f.pass_id = p.id
                    AND $2 BETWEEN f.starts_on AND f.ends_on)
GROUP BY pe.organization_id, pe.id, pe.display_name
HAVING min(p.starts_on) <= $3                                         -- (reading) held a pass for 30 days
   AND NOT EXISTS (SELECT 1 FROM scheduling.bookings b
                   JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
                   WHERE b.organization_id = pe.organization_id AND b.person_id = pe.id
                     AND b.status = 'attended' AND s.local_date > $3 AND s.local_date <= $2)
ORDER BY last_attended_on NULLS FIRST, pe.id
LIMIT 51;
```

- **(reading)** "No visit for 30 days" needs 30 days to have passed: someone whose first pass started this week is
  new, not at risk, so a person appears only once one of their valid passes started 30 or more days ago.
- A person whose pass is frozen today is left out: a freeze is an agreed absence.
- Longest absence first; people who never attended come first.

## 7. What is never in a report

- No health data of any kind: not the declaration status, not a count of declarations, not medical approval. The
  report queries do not read `people.health_declarations` at all (an architecture test can grep for it).
- No contact points (email, phone), birth dates, notes, consents or audit entries.
- No names in the summary. Names only in the two lists, and only for a caller who can already read every person
  record through `people.view` (R-6).
- No other studio's rows (RLS, section 5).
- Reads are not audited: aggregates and names the reader can already see. Nothing is stored or cached on the server.

## 8. Performance (R-5)

The hot paths and the indexes they use:

| Query | Index |
|---|---|
| sessions in the period | `ix_sessions_time (organization_id, starts_at)`; `local_date` is filtered after it, or by the primary key prefix |
| bookings per session | `ux_bookings_one_live (organization_id, session_id, person_id)` for live statuses; cancelled rows by the primary key prefix |
| a person's attended visits | `ix_bookings_person (organization_id, person_id, created_at)` |
| passes per person | `ix_passes_person (organization_id, person_id, ends_on)` |

R2 seeded 10 000 bookings **locally** (never on dev): one studio with 1 000 people, 1 300 sessions over about six
months and a pass each. It ran `EXPLAIN (ANALYZE, BUFFERS)` in the application role with `app.organization_id` set,
and the plans are on board #253. The 92-day session query took 3.9 ms and members at risk took 7.7 ms. Both plans
read `sessions` and `bookings` with a sequential scan, because one studio is the whole table, and they stay far
below the 50 ms bar. So no index is added. Look again when a studio passes about 100 000 bookings.

## 9. Deleting my login (A-1, A-2, P2 F6)

`DELETE /api/v1/me` with `{ "confirmEmail": "…" }`.

1. Recent sign-in (10 minutes), else 401 `auth.step_up_required`.
2. `confirmEmail` must equal `identity.user_accounts.email` without case and after trimming, else 400
   `account.confirmation_mismatch`.
3. In one transaction, in the application role as the account (its own memberships and person records are visible
   in every studio through `memberships_app` and `people_app_select`; each studio's writes run after
   `SetTenantAsync` for that studio):
   1. Lock the caller's memberships. For each studio where the caller is the owner (there is one owner per studio,
      `ux_memberships_one_owner`), answer 409 `account.sole_owner` with `organizationIds`. Nothing has changed yet.
   2. In each studio where the account has a membership or a person record: pending ownership transfers to or
      from its memberships are cancelled; every live membership gets `status = 'removed'`; the push subscriptions of
      its person record are deleted (they are this login's devices); and one audit row `account.deleted` is
      written, with the account id and no email or name.
   3. `identity.user_accounts` is deleted. The foreign keys of migration 0022 do the rest in the same statement:
      `external_identities` and `join_attempts` rows go (`ON DELETE CASCADE`), and `memberships.user_account_id`,
      `people.people.user_account_id` and `organizations.created_by_user_id` become null (`ON DELETE SET NULL`).
      The membership row stays, because bookings, passes and messages point at it as `booked_by`, `granted_by` and
      `sent_by`. The person record keeps its name, history, inbox and preferences: it is the studio's record, and the
      person can ask the studio to erase it (`erasePerson`), as before.
   4. One account-level audit row (`organization_id` null) with the number of studios.
4. After the commit, the API calls Cognito `AdminDeleteUser` for the caller's username in the customer pool. The Lambda's IAM grant
   names that one pool ARN (`cognito-idp:AdminDeleteUser`, no wildcard). If the call fails, the database is already
   clean and the user can't use Tempo anyway (`/me` answers 404 `account.not_provisioned`, and a new
   `POST /session` would make a fresh, empty account); the error is logged and a retry is safe.
5. 204. The app signs the person out.

**Migration 0022** makes `organizations.memberships.user_account_id` and
`organizations.organizations.created_by_user_id` nullable, with `CHECK (user_account_id IS NOT NULL OR status =
'removed')` on memberships, and sets the `ON DELETE` rules above on the five foreign keys to
`identity.user_accounts`. Lists that show removed members or old invitations read a deleted login as an empty email.
`AdminDeleteUser` costs nothing (ADR-0021).

## 10. Removing a studio (A-3, P2 F4)

`DELETE /api/v1/platform/organizations/{id}` with `{ "confirmName": "…" }`, operator pool only, recent sign-in.

- 409 `organization.not_suspended` unless the studio is `suspended`; 409 `organization.suspended_too_recently`
  with `deletableFrom` when it was suspended less than `Platform:StudioRemovalMinDays` ago (0 in
  `development.ts`, 30 in production).
- 400 `organization.name_mismatch` when `confirmName` is not the studio's name after trimming.
- One transaction in the platform role deletes every row whose `organization_id` is the studio, in foreign-key
  order, then the `organizations.organizations` row. The table list is **read from the catalog**
  (`information_schema.columns` where `column_name = 'organization_id'`), ordered by the foreign keys, so a table
  added later cannot be missed. The test seeds one row in every such table, deletes the studio and asserts zero rows
  left for that id anywhere (A2).
- Health declarations and push subscriptions go with the rest. Cognito users are not touched: a login may belong to
  other studios, and A-1 or A-4 removes a login.
- The audit keeps one row with `organization_id = NULL`, `action = 'platform.organization.deleted'`, `target_id` =
  the studio id and the name in `details`; the studio's own audit rows are tenant rows and go.
- Migration 0023 only if a foreign key needs an `ON DELETE` change; the ordered delete should make it unneeded.

## 11. The export without the health key (A-5, #239 note 2)

When the data key can't be read (SSM down, a missing version), `exportPerson` still returns 200 with everything
else. Each health declaration keeps its status and dates, `answers` is `null`, and the export's `healthAnswers`
part says `"withheld": "health_key_unavailable"`. The log gets one warning with the person id and the key version,
never an answer. The test makes the key provider throw and expects 200 with the withheld reason (it fails today with
503).

## 12. The e2e cleanup (A-4)

`node tools/scripts/e2e-cleanup.mjs` lists, on dev, logins whose email matches `^e2e-[a-z0-9-]+@example\.com$` and
studios whose name starts with `e2e-`. Without `--apply` it only prints. With `--apply` it deletes each login through
the A-1 flow (signed in as that user, which the e2e suites can do) or the operator, and each studio through A-3
(suspend, then delete). It needs the operator (Kris's step 1). A unit test proves the filter never matches a name
without the `e2e-` prefix.

## 13. API

The contract (`contracts/openapi/tempo-api.v1.yaml`) has the five operations marked `x-tempo-planned: true` until
their backend PR lands: `getReportSummary`, `listPassesEnding`, `listMembersAtRisk`, `deleteMe` and
`platformDeleteOrganization`. Shapes: `ReportSummary` (with `ReportTotals`, `ReportWeek`, `ReportClassType`,
`ReportFigures`), `PassesEndingReport`, `MembersAtRiskReport`, `DeleteMeRequest`, `DeleteOrganizationRequest`, and the
Problem members `organizationIds` and `deletableFrom`.

## 14. Apps (K2)

- admin-web **Reports** page behind `reports.view`, no menu item without it: a period picker (last 4 weeks by default,
  92 days at most), KPI tiles (attended, fill rate, active members, new members, each with the change against
  `previous`), the weekly chart, the per-class-type table, and the two lists only with `people.view`.
- client-web **Delete my account** on the profile: what the studio keeps (section 9, step 3.3) and what goes, the
  step-up, the typed email, and the 409 explained with a link to the ownership transfer.

## 15. Delivery plan (board #253)

| Task | What |
|---|---|
| R1 | this document, the planned contract rows, the regenerated client (SYNC 6a) |
| R2 | migration 0021, the three report endpoints, tests, the local `EXPLAIN` |
| A1 | migration 0022, `DELETE /me`, the IAM grant, tests (SYNC 6b) |
| A2 | the operator's studio removal, the catalog-walking test |
| A3 | the export fallback |
| A4 | the cleanup script |

## 16. Open items for Kris

- The two **(reading)** rules in section 6: a renewed pass is not "ending", and nobody is "at risk" in their first
  30 days with a pass.
- `StudioRemovalMinDays = 30` on prod is a config value; change it before prod if the lawyer wants longer (P-2).

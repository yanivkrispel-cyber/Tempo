# Health Declaration LLD (pilot readiness)

> **Status:** Decision for H-1 to H-9 (Kris, 2026-10-17, day board #232). The form's wording is a **draft** until
> the lawyer check (P-2); the retention rule (H-8) is provisional until P-2.
> **Audience:** Kris, Ofir, the agents.
> **Related:** ADR-0021 ($0 until revenue), ADR-0026 (field-level encryption on the $0 path), docs/27 (people,
> permissions, erase, export), docs/29 (booking), docs/30 section 10 (audit without content).

A studio that teaches movement asks every client for a health declaration before the first class: a short list of
yes or no questions and a signature. A "yes" means the client brings a doctor's approval first. Studios keep these on
paper today. This document moves the declaration into Tempo, which makes Tempo hold health data: the most sensitive
thing it stores. Most of this document is about how little of it anyone sees.

The same pilot-readiness change replaces the member home's sample numbers with real progress (section 12).

## 1. Scope

In:

- one platform form in Hebrew, versioned, yes or no per question (H-1, H-2);
- the member signs for themselves, or a guardian signs for them (H-7);
- four statuses, valid 12 months (H-3); staff see the status, only `health.view` sees the answers (H-4);
- an optional booking gate per studio (H-5);
- field-level encryption in the application with a key in SSM (H-6, ADR-0026);
- medical approval recorded by a `health.view` holder (H-9);
- erase, export and retention (H-8).

Out, and where it goes:

| Item | Where |
|---|---|
| A studio's own questions | Part two, after the lawyer check; part one's questions are the platform's |
| Free text answers, a drawn signature | Not planned; free text invites detail nobody should store |
| Uploading the doctor's approval | Files are part two of Phase 4 |
| An age check for minors | Not in part one (H-7) |
| Reminders that a declaration expires | After the pilot; it would be a new notification kind |
| A customer-managed KMS key | At revenue (ADR-0021 tripwire; ADR-0026) |

## 2. Decisions

| Id | Decision |
|---|---|
| H-1 | One platform form in Hebrew, versioned. Its wording is a draft until the lawyer check (P-2). Studios cannot edit the questions in part one. |
| H-2 | Yes or no per question, no free text. A signed name, the signer's role (`self` or `guardian`, with the guardian's name) and a confirmation checkbox. |
| H-3 | Status `missing`, `signed`, `needs_medical_approval` (any "yes"), `expired`. Valid for 12 months from signing. A new form version does not expire existing signatures. |
| H-4 | Status with `people.view`. The answers only with a new permission `health.view`, granted to the owner role by default. Every read of answers is audited as `health.declaration.viewed`, with no content. |
| H-5 | A studio setting `requireHealthDeclaration`, off by default. When on, a member's own booking or waitlist place without `signed` gets 409 `health.declaration_required`. Staff booking on someone's behalf is not blocked, and is audited. |
| H-6 | AES-256-GCM in the application. The answers, the signed name and the guardian's name are encrypted; the key version is stored per row. No plaintext in the database, logs, audit, inbox or push. The key is created once per environment by a tools script. |
| H-7 | A guardian may sign (signer role `guardian`). No age check in part one. |
| H-8 | The current declaration stays until the person is erased. A replaced declaration is deleted 90 days after its successor by the retention job. Provisional until P-2. |
| H-9 | A `health.view` holder records "medical approval received" with a date. That moves `needs_medical_approval` to `signed`. No document upload. |

## 3. The form

- The form is code, not a table: `HealthForms` in the People module holds each version as a list of questions, each
  with a stable id (`q1`, `q2`, ...) and its Hebrew text. Changing a question's meaning is a new version; fixing a
  typo is not. The current version is the highest one.
- Version 1 is the draft wording until P-2. The questions in this repository and in its tests are generic ("Has a
  doctor told you to limit physical activity?"); no real person's answers exist anywhere outside the database.
- A signature names the version it answered. The answers are stored by question id, so an old signature stays
  readable when a new version exists.
- A new version does not expire existing signatures (H-3). The member app offers the new version when the current
  signature expires.

## 4. Status

| Status | When |
|---|---|
| `missing` | No current declaration for this person in this studio. Also after erase. |
| `signed` | A current declaration, every answer "no", not expired. Or one with a "yes" and a recorded medical approval. |
| `needs_medical_approval` | A current declaration with at least one "yes" and no medical approval, not expired. |
| `expired` | A current declaration whose `expires_at` has passed, whatever its answers. |

- `expires_at` is `signed_at` plus 12 calendar months, stored on the row. Status is computed at read time from the
  row and the clock; there is no job that flips a column at midnight.
- Signing again replaces the current declaration: the old row gets `superseded_at` and stays for 90 days (H-8).
- The status is less sensitive than the answers, but it is not nothing: `needs_medical_approval` tells a reader that
  some answer was "yes". H-4 accepts that for `people.view` (owner, admin, staff), because a front desk has to know
  whom to stop.

## 5. Permissions

- New key `health.view`: "Read health declaration answers and record medical approval". Migration 0018 adds it to
  the owner role (H-4). Admin and staff do not get it. An owner can give it to a custom role (docs/27 section 3.2)
  when custom roles exist.
- Status reads need `people.view`. The member's own declaration is the "self" rule (docs/27 section 3.4): no
  permission needed.

| Action | Who |
|---|---|
| Read my status and the current form; sign | the member (self) |
| Read a person's status | `people.view` |
| Read a person's answers, signed name and guardian's name | `health.view`, audited per read |
| Record medical approval | `health.view` |
| Switch the booking gate | `schedule.manage` (the booking policy) |
| Roster entries show a health status | `bookings.manage` or the instructor, and the status only when the caller also holds `people.view` |

## 6. Database (migration 0018)

`people.health_declarations`:

| Column | Type | Note |
|---|---|---|
| `organization_id` | uuid | RLS like `people.people` |
| `id` | uuid | v7 |
| `person_id` | uuid | FK `people.people` |
| `form_version` | int | |
| `signer_role` | text | `self` or `guardian` |
| `has_yes` | boolean | Derived at signing; drives the status without decrypting |
| `signed_at`, `expires_at` | timestamptz | |
| `key_version` | int | The data key version this row was encrypted with |
| `answers_ciphertext` | bytea | JSON `{"q1":false,...}`, encrypted |
| `signed_name_ciphertext` | bytea | encrypted |
| `guardian_name_ciphertext` | bytea, null | encrypted, only for `guardian` |
| `medical_approval_on` | date, null | H-9 |
| `medical_approval_by` | uuid, null | the recording membership |
| `superseded_at` | timestamptz, null | set when the person signs again |
| `created_at` | timestamptz | |

- One current row per person: a partial unique index on `(organization_id, person_id) WHERE superseded_at IS NULL`.
- RLS: the same tenant policy as `people.people`; the API's role gets select, insert and update; delete only for
  erase and the retention job.
- The booking gate's switch is a column on the existing booking policy: `scheduling.booking_policies.
  require_health_declaration boolean NOT NULL DEFAULT false`.
- No plaintext column holds an answer or a name. A test reads the raw row and searches it for the plaintext.

## 7. Encryption (H-6, ADR-0026)

- **Cipher:** AES-256-GCM (`System.Security.Cryptography.AesGcm`), a random 12-byte nonce per field, a 16-byte tag.
  Stored as `[format byte 0x01][nonce 12][ciphertext][tag 16]`.
- **Associated data:** `organization_id | declaration id | column name | key_version`. A ciphertext copied into
  another row, another column or another studio fails to decrypt instead of showing the wrong person's answers.
- **Key:** 32 random bytes, base64, in an SSM SecureString parameter `/tempo/{env}/health/data-key/{version}`,
  encrypted by the AWS-managed `aws/ssm` key. Standard tier, no customer-managed key: $0 (ADR-0021). The API reads
  it on first use and keeps it in memory for the container's life, so KMS sees a handful of decrypt calls a day,
  inside the free requests.
- **Configuration:** `HEALTH_DATA_KEY_PARAMETER_PREFIX` (`/tempo/dev/health/data-key/`) and
  `HEALTH_DATA_KEY_CURRENT_VERSION` (`1`). Locally and in tests, `HEALTH_DATA_KEY_V{n}` carries the base64 key
  directly, as `VAPID_PUBLIC_KEY` does for push.
- **Writes** use the current version. **Reads** use the row's `key_version`.
- **Fail closed:** a missing parameter, a wrong key or a failed tag answers 503 `health.key_unavailable` for answer
  reads and signing. It never returns partial data or falls back to another version. Status reads do not need the
  key (`has_yes` is plaintext), so the front desk keeps working.
- **IAM:** the API's role gets `ssm:GetParameter` on the exact readable versions,
  `parameter/tempo/{env}/health/data-key/1` today (`HEALTH_DATA_KEY_READABLE_VERSIONS` in
  `infrastructure/lib/api/health-parameters.ts`), with no wildcard. The `aws/ssm` key policy already lets the
  account's principals decrypt through SSM, so no `kms:*` statement is added. The worker gets nothing: it never reads
  answers (the retention job deletes rows without opening them).

### 7.1 Key life cycle

1. **Create** once per environment: `node tools/scripts/health-data-key.mjs --environment dev --profile tempo`. The
   script generates the key with `crypto.randomBytes(32)`, writes version 1 as a SecureString that is never
   overwritten, and prints only the parameter name. CloudFormation cannot create SecureStrings, so this is a
   person's step, as with the VAPID keys.
2. **Rotate** (planned, not built in part one): the script writes version `n+1` (`--version n+1`); a deploy adds it
   to the readable versions and sets `HEALTH_DATA_KEY_CURRENT_VERSION`; new signatures use it; a re-encrypt command rewrites old rows to the new
   version; when no row holds version `n`, its parameter is deleted. Rotation is due when a person with access to
   the key leaves, or at the move to a customer-managed key.
3. **Lose:** without the parameter the answers cannot be read. Statuses still work. Members sign again. Before
   production, Kris decides whether a second copy of the key is kept offline (an open item, not a default).
4. **Never:** the key is never printed, logged, committed, put in an environment variable of a deployed function,
   or copied to a Neon branch. A Neon restore or branch holds ciphertext only.

## 8. Threat model

| Threat | What stops it |
|---|---|
| A database dump, a Neon branch, a restore drill, a leaked connection string | Ciphertext only; the key is in SSM, not in Neon |
| A staff member who should not know a client's answers | Answers need `health.view` (owner only); status reads never decrypt |
| A curious owner reading everyone's answers | Each read is audited (`health.declaration.viewed`), one event per person read; no list route returns answers |
| An answer leaking through logs, audit, inbox or push | No log line carries a request body; audit events carry ids and counts only; no notification kind carries health data in part one; a test searches API logs and audit rows for the plaintext |
| A ciphertext moved to another person's row | GCM associated data binds it to the row, the column and the studio |
| Tenant crossover | RLS on the table, the route filter, and the associated data |
| A key version that does not match | Fail closed, 503, never another version |
| An admin with `audit.view` | Sees that answers were viewed, by whom and when; never the content |
| Someone with AWS admin access to the account | Can read the parameter. Accepted until revenue: CloudTrail records every SSM read; a customer-managed key with a narrow key policy is the step up (ADR-0026) |
| A compromised API function | Has the key while it runs. IAM limits it to the one parameter path |
| A browser or proxy caching an answers response | `Cache-Control: no-store` on the answers route |

## 9. API

Contract section "Health declaration", `x-tempo-planned` until H2 builds it.

| Route | Who | Operation |
|---|---|---|
| `GET /organizations/{id}/me/health-declaration` | the member | `getMyHealthDeclaration`: status, the current form, the current declaration's dates, and whether the studio requires it |
| `POST /organizations/{id}/me/health-declaration` | the member | `signMyHealthDeclaration`: answers, signed name, signer role, guardian's name, confirmation |
| `GET /organizations/{id}/people/{personId}/health-declaration` | `people.view` | `getPersonHealthDeclaration`: status and dates, no answers, no names |
| `GET /organizations/{id}/people/{personId}/health-declaration/answers` | `health.view` | `getPersonHealthDeclarationAnswers`: answers, the form they answered, names; audited; `no-store` |
| `POST /organizations/{id}/people/{personId}/health-declaration/medical-approval` | `health.view` | `recordMedicalApproval`: the approval date |
| `GET/PUT /organizations/{id}/booking-policy` | as today | `requireHealthDeclaration` joins the policy |
| `GET /organizations/{id}/sessions/{id}/roster` | as today | each entry gains `healthStatus` |

Errors:

| Code | Status | When |
|---|---|---|
| `health.declaration_required` | 409 | The gate is on and the member's own booking or waitlist place has no `signed` status |
| `health.form_version_stale` | 409 | The member signed a version that is no longer current; the app reloads the form |
| `health.answers_incomplete` | 400 | A question of that version has no answer, or an unknown question id |
| `health.signed_name_invalid` | 400 | The member's name is not 2 to 100 characters, or has control characters |
| `health.confirmation_required` | 400 | `confirmed` is not true |
| `health.guardian_name_required` | 400 | Signer role `guardian` without the guardian's name |
| `health.no_approval_needed` | 409 | Medical approval recorded on a status other than `needs_medical_approval` |
| `health.key_unavailable` | 503 | Section 7, fail closed |

- Validation: signed name and guardian's name 2 to 100 characters after trimming, no control characters; the approval
  date not in the future and not before the declaration was signed.
- `signedName` is the member's full name, whose declaration it is. `guardianName` is the guardian who signs, only
  for `signerRole: guardian`. Neither is compared with the person record; staff see both with the answers.

## 10. The booking gate (H-5)

- `requireHealthDeclaration` is off by default, on the booking policy (`schedule.manage`), with the policy's version
  and `If-Match` (E-1: optional, as on every versioned PUT).
- When on, `createBooking` by the member for themselves, booked or waitlisted, needs status `signed`; otherwise 409
  `health.declaration_required`. `needs_medical_approval` and `expired` are refused too.
- Staff booking for someone else is not blocked. When the person's status is not `signed`, the booking writes the
  audit event `booking.health_gate_bypassed` (booking id, person id, the status; no answers).
- A waitlist promotion, a move and a cancel are not gated: the place was taken when the gate passed or was off.
- Switching the gate on does not cancel existing bookings.

## 11. Erase, export, retention, audit

- **Erase** (docs/27 section 4.7): deletes every declaration row of the person, current and replaced. The audit
  event `person.erased` gains a count of deleted declarations.
- **Export** (`people.export`, step-up): the export gains `healthDeclarations`, each with its version, dates,
  status, signer role and, decrypted, its answers and names, but only when the exporting member also holds
  `health.view`. Without it the export lists the declarations without answers or names and says so in
  `healthAnswersWithheld: true`. A decrypting export writes one `health.declaration.viewed` event per declaration,
  with `purpose: export`. The export goes to the person; the person's own copy is the reason it exists.
- **Merge** (docs/27 section 4.6): the merged record's declarations move to the survivor. The ciphertext is bound to
  the declaration, not the person, so it still opens. If both had a current declaration, the newer signature stays
  current and the older one is replaced (and retention deletes it 90 days later).
- **Retention** (H-8): the daily retention job deletes declarations whose `superseded_at` is more than 90 days
  ago. `RetentionPolicy.Default` gains `ReplacedHealthDeclarationDays = 90`, provisional until P-2.
- **Audit events** (ids, versions and counts only; never an answer, a name or ciphertext):

| Event | Data |
|---|---|
| `health.declaration.signed` | declaration id, form version, signer role |
| `health.declaration.viewed` | declaration id, purpose `view` or `export` |
| `health.medical_approval.recorded` | declaration id, the date |
| `booking.health_gate_bypassed` | booking id, person id, status |
| `person.erased` | gains `healthDeclarations`, the count deleted |

The retention job is not a member's action, so it writes no audit event: the worker logs the count of replaced
declarations it deleted, with the other retention counts.

## 12. Member progress (G-1 to G-3)

The member home shows how often the member came this month, against a goal they set, and how many weeks in a row
they came. It replaces the progress part of `apps/client-web/src/features/member/sample.ts`.

| Id | Decision |
|---|---|
| G-1 | The member sets a monthly goal, 1 to 31, per studio; none by default. The home hides the goal ring until one is set. |
| G-2 | Streak: consecutive weeks (Sunday to Saturday, in the studio's time zone) with at least one attended class. The current week counts only once it has one. |
| G-3 | Only `attended` counts. Bookings and no-shows do not. |

- Migration 0017: `scheduling.member_goals (organization_id, person_id, monthly_goal smallint CHECK 1 to 31,
  updated_at)`, primary key `(organization_id, person_id)`, RLS like the other scheduling tables. Clearing the goal
  deletes the row. Erase deletes it.
- `GET /organizations/{id}/me/progress` (`getMyProgress`): `visitsThisMonth`, `monthlyGoal` (null when unset),
  `streakWeeks`, `month` (`2026-10`) and the studio's `timeZone`. Computed from the member's bookings with
  attendance `attended`, by the session's start in the studio's time zone.
- `PUT /organizations/{id}/me/progress/goal` (`setMyMonthlyGoal`): `{ "monthlyGoal": 12 }` sets it,
  `{ "monthlyGoal": null }` clears it. Returns the progress.
- Streak: walk back week by week from the current week. If the current week has an attended class, it counts and
  the walk continues; if not, the walk starts from last week without breaking the streak. The first week without an
  attended class ends it. The walk stops at 104 weeks.
- Tests: a class at 23:30 local on the last day of the month counts for that month, not the next (UTC is already
  the next day); a class at 23:30 on Saturday counts for that week; a week with only a no-show breaks the streak;
  the current week with nothing yet does not.

## 13. Apps

| Screen | App | Who |
|---|---|---|
| Profile: declaration status, sign, renew when expired, what `needs_medical_approval` means | client-web | the member |
| Booking sheet: 409 `health.declaration_required` explained, with a link to the form | client-web | the member |
| Home: goal ring and streak from the API; profile: set the goal | client-web | the member |
| Booking policy: "require a declaration to book" | admin-web | `schedule.manage` |
| Person card: status; "show answers" (each open is an audited read); "record medical approval" | admin-web | `people.view`; `health.view` |
| Roster rows: a mark for missing, expired and needs approval | admin-web | roster readers with `people.view` |

The apps never cache answers: no TanStack Query persistence for the answers query, `gcTime` 0, cleared on close.

## 14. Delivery plan (board #232)

| Step | What | Task |
|---|---|---|
| 1 | This document, ADR-0026, contract rows with `x-tempo-planned` | H1 |
| 2 | Progress: migration 0017, endpoints, tests at month and week edges | P1 |
| 3 | Declaration: migration 0018, encryption, key script, IAM, endpoints, gate, roster, erase, export, retention | H2 |
| 4 | Screens on the planned types | X0 to X3 (K2) |
| 5 | Live check on dev; Playwright `sync5` | H5, X4 |

## 15. Open items for Kris

| Item | Note |
|---|---|
| P-2 | The form's wording and the retention rule, with the lawyer |
| P-4 | The consent text shown above the signature |
| Key backup for production | Whether an offline copy of the production data key is kept (section 7.1) |
| Customer-managed KMS key | At revenue (ADR-0026) |

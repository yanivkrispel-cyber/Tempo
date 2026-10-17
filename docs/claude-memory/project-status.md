# Project status

Updated 2026-10-17, evening (day boards #232, DAY-PLAN-5: pilot readiness, and #253, DAY-PLAN-6: owner reports
and removing logins and studios).

## In one paragraph

Phases 0 to 3 of `docs/24` are on `main` and live on dev (Phase 3 thin: the free pilot plan), and so is the first
vertical skeleton, Studio scheduling and passes (docs/29), backend and screens, including the night's additions A0 to
A5. Next is Phase 4 part one, notifications (`docs/30` steps 1 to 4 and 6: inbox router, preferences, quiet hours,
web push, reminders, migration 0014); email (step 5) waits for Kris's D-1. The repo is **public** since 2026-10-15:
no secrets, tokens, real people's emails or personal data in code, PRs, issues or logs.

## Phase 0 (foundation): closed, except the edge

- Dev deploys from CI on every merge to `main` (`deploy-development.yml`): stacks, migrator and a smoke test.
  Dev API: `https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com`. Only docs skip it; `deploy-web` publishes the apps to Cloudflare Pages (ADR-0027).
- AWS refused CloudFront on 2026-10-17 (case 179198465900800). The dev apps are on Cloudflare Pages (ADR-0027):
  https://tempo-studio-console.pages.dev and https://tempo-members.pages.dev, published by `deploy-web` in
  `deploy-development.yml` once the secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID exist. Lambda
  concurrency is still 40 (quota case 179192381800130).
- Operations (night of 2026-10-15): the dashboard answers the night questions (queue, concurrency, daily jobs,
  canary, Scheduler; #145), the canary checks health every 5 minutes and a signed-in read hourly (#119), the Neon
  restore drill and `docs/runbooks/restore.md` (#149: 6 h restore window on Free, a branch in about 4 s), the pilot
  onboarding runbook (#146), and the demo studio on dev (#140; remove it with
  `node tools/scripts/demo-studio.mjs clean --profile tempo`).

## Phase 1 (identity, studios, tenancy): done

docs/26 and ADR-0023, PRs #30 to #43 and #52. Migrations 0002 to 0004.

## Phase 2 (authorization and people): done (2026-10-15)

docs/27 with every section 14 default decided by Kris (#47). Permissions on every tenant route, the roles API with
step-up, owner transfer (tenant and operator), people, contact points, consent, relationships, duplicates and
merge, export and erase, inviting a recorded person (#61 to #88). Migrations 0005 to 0008. Privacy fixes: the audit
log keeps no invitee email, erasing a person revokes and scrubs their invitations (#90) and reaches invitations after
a merge (#138); a removed, suspended or demoted inviter's invitations stop working (#137).

## Phase 3 (billing and entitlements): thin, done (2026-10-15)

`docs/28` (#83), section 14 defaults apply. #105 shipped the free `pilot` plan with an **active** subscription per
studio, entitlements, plan limits, restricted mode and the billing page (migration 0009). No payment provider until a
studio is ready to pay (B-1, B-2, B-6 go back to Kris then). The console's settings page shows the plan (#174).

## Studio skeleton: scheduling and passes (done 2026-10-15/16)

| Step | PR |
|---|---|
| LLD `docs/29_Studio_Scheduling_and_Passes_LLD.md` (open questions C-1 to C-8 have defaults) | #91 |
| contract-v3 (`x-tempo-planned` until built; the conformance test checks both ways) | #92 |
| Migration 0010: `scheduling` and `notifications` schemas, RLS, six permission keys | #93 |
| Timetable, passes, booking, waitlist with promotion, roster, attendance, booking policy, inbox | #95 |
| Daily job: eight-week horizon, closed waitlists (second Scheduler schedule, $0) | #100 |
| A0 docs/29 section 16 (moves, messages, calendar files, freezes; C-9 to C-13 have defaults) | #143, #160 |
| A1 a weekly class carries class type, instructor and room; roster entries carry entries left | #148 |
| A2 move a booked place to another class (migration 0011) | #154 |
| A3 a message from staff to everyone registered (no text in the audit log) | #156 |
| A4 add to calendar, an `.ics` of the caller's own booking | #157 |
| A5 freeze a period membership (migration 0012); `Session.frozenUntil` for the booking sheet | #158, #172 |
| Screens: console schedule, products, roster (#129); client-web booking, waitlist, inbox (#128); A1 to A5 | #153 #162 #168 #170 #169 |

- Concurrency is in the schema: `booked_count <= capacity` and `entries_used <= entries` are CHECKs, and the
  services take places and entries with guarded updates. Tests: 20 parallel bookings for 8 places give 8 booked and
  12 waiting; parallel bookings on a card's last entry spend it once.
- `StudioScheduleFlowTests` runs the demo of docs/29 section 1 through the real host. SYNC 2 runs the same demo in
  the browser with Playwright against dev (#155, 11/11 on dev).
- Migration 0013 (#159) holds the #124 backend lows: `platform_admin.operator_notes`, the no-op suspend audit and
  read-only self-clause policies. Migrations on dev: up to 0013; 0014 is the next free number (`docs/30`).
- Retention job (#152): `tempo-dev-retention-daily` at 03:45 Israel time deletes finished invitations after 90 days
  and inbox items after 180 days (`RetentionPolicy.Default`, provisional until Kris confirms).

## Phase 4 part one: communications (designed; building since 2026-10-16)

`docs/30_Communications_LLD.md` (#147). Kris approved on 2026-10-16 that D-3, D-4, D-5, D-6, D-8 and D-9 apply as
provisional defaults, so steps 1 to 4 and 6 are built on board #176. D-1, D-2 and D-7 (domain, sender, marketing
wording) wait for Kris, so step 5 (email, SES) is not built. Every piece stays inside ADR-0021: VAPID keys in SSM
standard parameters, the reminder job inside the existing Scheduler pattern, no paid push service.

## Pilot readiness (2026-10-17, board #232)

`docs/31_Health_Declaration_LLD.md` and ADR-0026 (#233). What a real studio needs and what still blocks it:
`docs/runbooks/pilot-readiness.md`.

| Piece | PR |
|---|---|
| Member progress: visits this month, monthly goal, streak of weeks (migration 0017) | #235; screens #236 |
| Health declaration: answers and names AES-256-GCM in the app, key in SSM `/tempo/<env>/health/data-key/<v>` under `aws/ssm` (no CMK), status for `people.view`, answers for `health.view` (owner) with an audited read, medical approval, the booking gate on the booking policy, roster status, erase, export, merge, retention after 90 days (migration 0018) | #239, #244; screens #237, #238 |
| Live checks on dev: H5 (`tools/scripts/health-live-check.mjs`, 17/17) and Playwright `sync5` (6/6) | #248, #247 |
| #124 and #109 closed (Function URL pinned by `edgeDistributionId` once the edge exists; CFR4 moved to #241, the role scope check to #245) | #242 |
| #208 follow-ups: WAF `URL_DECODE`, the bare `\r`, one return-entry helper, the drill's error, nag over every stack | #243 |

- The dev health key exists (created 2026-10-17 with `tools/scripts/health-data-key.mjs`). A version is never
  overwritten; rotation is a new version (docs/31 section 7.1).
- Migrations on dev: up to 0023 since board #253; 0024 is the next free number.

## Owner reports and removal (2026-10-17 afternoon, board #253)

`docs/32_Reports_LLD.md` (R1 #255) holds R-1 to R-6 and A-1 to A-5, every report query with its RLS reasoning, and
what is never in a report.

| Piece | PR |
|---|---|
| Every GitHub Action pinned to a commit SHA, #186's bumps folded in (#186 closed), `tools/scripts/lib/*.test.mjs` in the Infrastructure job | W1 #254 |
| Owner reports: summary per week and class type with the previous period, passes ending soon, members at risk; `reports.view` for owner and admin (migration 0021); no index (a local `EXPLAIN` on 10 000 bookings: 3.9 ms and 7.7 ms) | R2 #259; Y0 #256, Y1 #257 |
| `DELETE /me`: step-up, the email typed, 409 for a sole owner; the person record stays with the studio; Cognito `AdminDeleteUser` on the customer pool only (migration 0022: `ON DELETE` rules on the five keys to `identity.user_accounts`) | A1 #262, #267; Y2 #258 |
| The operator removes a suspended studio: a `SECURITY DEFINER` function walks the catalog (migration 0023); the platform role still has no `DELETE`; 0 days suspended on dev, 30 elsewhere | A2 #263 |
| The export answers 200 with every health answer withheld when the key can't be read (`healthAnswersWithheldReason`) | A3 #264 |
| pnpm `minimumReleaseAge` and `blockExoticSubdeps`, compose `no-new-privileges`; `trustPolicy` left for Kris (#115 stays open for it) | W2 #265 |
| `tools/scripts/e2e-cleanup.mjs`: dry run lists e2e logins, studios and orphaned account rows; `--apply` needs the operator token | A4 #266 |
| Playwright `sync6` on dev at phone width (6/6: one visit and 25% on the report, 403 without `reports.view`, the member deletes their login and stays on the roster) | Y3 #261 |

## Apps

`apps/client-web` and `apps/admin-web` run on the real API for Phases 1 to 3 and the scheduling skeleton (sign-in
with the Hosted UI and TOTP enrollment, studios, members, invitations, roles, people, consent, owner transfer,
duplicates, export, erase, timetable, booking, waitlist, inbox, passes, moves, messages, calendar files, freezes,
the plan card). Since 2026-10-17 nothing is sample data: the home goal and streak and the health declaration are on the API, and
`features/member/sample.ts` is gone (#236, #237). Member render code reads time from `features/member/clock.tsx`, never `Date.now()`
(the `react-hooks/purity` lint rule). The console fits a phone (#171). #164 (axe contrast) is open.

## Open items for Kris

| Item | Note |
|---|---|
| Register as the first operator | `tools/scripts/register-operator.ps1`, needs Kris's MFA |
| IAM grants so CI can run the smoke test with `--sign-in` | `cognito-idp:AdminInitiateAuth` and `ssm:GetParameter` for the deploy role |
| Confirm the canary's SNS email subscription | From #119 |
| Retention days | 90 days invitations, 180 days inbox items (`RetentionPolicy.Default`) |
| `docs/30` D-1, D-2, D-7, and a look at the provisional defaults | Email waits for D-1 (the domain first) |
| `docs/29` C-9 to C-13 | Defaults apply unless Kris objects |
| #97 dev self sign-up and a Neon usage alarm | It gated the full load test (B5) |
| #96, #123, #122 | Kris decides; nobody else touches them |
| #115: pnpm `trustPolicy` | The frozen install fails on `semver@6.3.1` and `undici-types@6.20.0`; every other row of #115 is done |
| Consent texts (P-4) and the accountant/lawyer check (P-2) | Before the pilot; P-2 now also covers the health form's wording and its retention (docs/31) |
| A production copy of the health data key | docs/31 section 15 |
| Run `tools/scripts/e2e-cleanup.mjs --apply` with an operator token | Removes the seven e2e studios on dev (six `e2e-p2-…`, one `e2e-sync6-…`; P2 F4) |
| 14 orphaned e2e account rows on dev | Their Cognito users are gone (one more per sync6 run); an operator route or a one-off SQL |
| The two **(reading)** report rules in docs/32 section 6 | A renewed pass is not "ending"; nobody is "at risk" in their first 30 days |
| `TEMPO_STUDIO_REMOVAL_MIN_DAYS` and Neon's point-in-time history | 30 days by default outside dev; a removed studio stays in Neon's history until it ages out |
| Owner MFA switch (`TEMPO_REQUIRE_OWNER_MFA`) | The TOTP enrollment screen is in (#127, #150) |

## Who works on what

Split by area, not by task, so the two machines rarely touch the same files. The meeting point is the API contract
in `contracts/openapi/`.

| Area | Owner |
|---|---|
| `backend/`, `tests/`, `infrastructure/`, database migrations, `docs/` (ADR, LLD), writing `contracts/openapi/` | Kris's machine (Kris + Claude) |
| `apps/`, `packages/` (design system, API client), the Frontend CI job | Ofir's machine (Ofir + Claude) |

- Database migrations: only Kris's machine writes them. Ofir asks for a schema change instead.
- Shared files that can conflict: `pnpm-lock.yaml` and the root `package.json` (on conflict, regenerate with
  `pnpm install` on top of `main`, never hand-merge), `.github/workflows/`, `CLAUDE.md` and this folder.
- A contract PR may regenerate `packages/api-client/src/generated/schema.ts` (mechanical; #75, #92).
- Each side reviews the other's PRs, approval on the head commit. On 2026-10-15 afternoon Kris waived [O]'s review
  while [O] was inactive; the merge gate (green checks, no deploy running, last deploy green) still applied.
- Since 2026-10-15 afternoon Kris's machine may run two agent sessions: the quality lane (Wave Q on #89, CI and
  security) and the scheduling lane. The scheduling lane does not edit `.github/workflows/`.
- Merges are squash, except the Phase 1 chain #32 to #40 and #43 and the Phase 2 backend chain, which merged with
  merge commits.

### 2026-10-16 to 2026-10-17 07:00: lanes O1 and O2 (board #176)

Kris's agents rest, so both lanes run on Ofir's machine, approved by Kris on 2026-10-16 10:45. **[O1]** covers
Kris's areas above (backend, contracts, the generated client, migrations, infrastructure, tools, docs, the lock
file); **[O2]** is Ofir's lane (formerly [O]). Both post from the same GitHub account, so the review is a
`REVIEWED #N on <sha>` comment on the board, and it counts as the approval for the gate. Kris's split above applies
again from 2026-10-17 07:00.

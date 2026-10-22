# Project status

Updated 2026-10-22, night (board #445, DAY-PLAN-11), with what boards #380 (2026-10-19 night) and #404 (2026-10-20)
landed: white label, the branded sign-in, studio marketing stages A and B, share links by intent and the public
surface's protections. Earlier: #347 (2026-10-18), #232, #253 and #321 (2026-10-17).

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
  `deploy-development.yml` (the secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set; every deploy
  since #310 publishes and smoke-tests both apps). Lambda concurrency is still 40 (quota case 179192381800130).
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
- Migrations on dev: up to 0025 since board #321 (0024 `people.import`, 0025 tags and notes); 0026 is the next free
  number. The design session's #322, #324 and #326 planned 0024 to 0027 and must move to 0026 and up.

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

## D15, member import, notes and tags (2026-10-17 night, board #321)

`docs/34_Member_Import_Notes_and_Tags_LLD.md` (I1 #323) holds I-1 to I-8 and N-1 to N-7. `docs/33` is the design
session's Studio Experience LLD (#322, open).

| Piece | PR |
|---|---|
| D15: every console on a phone, a tablet and a computer; the coach's `/o/:slug/today`; `tp-table--stack`, drawer and bottom bar; the `screens` e2e project. Merged at 18:10 by the screens session **without a lane's review**; K2 reviewed it after the merge | #318, #320; fixes #328 |
| The status snapshot script and runbook (`tools/scripts/status-snapshot.mjs`, `docs/runbooks/status-page.md`); the main guard now imports safely, with tests | C1 #309; U7 |
| Member import: the console reads the CSV in the browser; `POST …/people/import` dry run and commit, `exists` / `duplicate_in_file` / `invalid` per row, set-based SQL (1,000 rows in about 1.1 s locally), `people.import` for owner and admin (migration 0024), an optional batch tag | I2 #325, I3 #329 |
| Tags and staff notes: 100 tags a studio, 20 a person, notes up to 1,000 characters, `people.tags.manage`, `people.notes.view` / `manage` / `moderate` (migration 0025); erase, merge, export and studio removal cover them; the audit keeps ids only | N1 #327 |
| Live checks on dev (smoke owner): the import's dry run, and a tag-note-export-erase round trip on one fictional e2e person | board #321 |

- The export now carries a person's tags and staff notes (author by role): a **(reading)** for Kris and the lawyer
  (P-2), docs/34 section 9.
- Fictional phones in tests: libphonenumber rejects `050-00000xx` and `050-1234567`; tests that need a valid number use
  a few `050-23456xx` values.

## Premium redesign (approved 2026-10-17, D16 to D20): landed and live on dev

Kris approved the "Warm Glass" mockups and the redesign, and asked that every capability they show exists first.
Plan and design: `docs/33_Studio_Experience_LLD.md` (capability matrix C1 to C25, steps E0 to E10, migrations 0026
to 0029): rooms with spots and the usual spot, buddies, instructor profiles (bio, Instagram, playlist), pictures on
S3, the instructor's note, the check-in QR, owner insights (sales and forecast, occupancy, suggestions, activity,
search), progress weeks, the design system v1.0 and both apps. All of it is on `main` and live on dev since
2026-10-18 (#324 to #346); E10's end-to-end proof is board #347 below.

## Installable apps, #345 hardening and the premium flows on dev (2026-10-18 night, board #347)

| Piece | PR |
|---|---|
| Kris's logo; the mark redrawn as SVG (`docs/design/brand/`), a temporary logo until Kris replaces it | K1 #348 |
| Both apps install on Android and iPhone: icons (192, 512, maskable, apple-touch), `id`, screenshots, shortcuts | O1 #352 |
| Install from inside the app (home card after a booking, profile and settings rows, the iPhone steps) | O2 #356 |
| The install gate: every deploy runs `tools/scripts/pwa-check.mjs` against both live apps | K2 #349 |
| Uploads are a presigned POST capped at 8 MB by S3 itself; the PUT is gone; CORS is POST only | H-1 #351, O3 #358, H-1b #371 |
| The apps' CSP allows the media bucket (no picture could be uploaded or shown from the live apps before) | #372 |
| Check-in scan limits: staff checked before the code, attempts committed before counting, 10 a person an hour (migration 0030) | H-2 #354 |
| New pictures under `media/<org>/<id>/` from 2026-10-20 00:00 UTC (the UUIDv7 picks the layout); finalize locks the row | H-3 #368 |
| The check-in secret is encrypted with the health data key (migration 0031); drop the plain column later (#374) | H-4 #373 |
| Finalizing an upload that never arrived is 409, not 500 (S3 answers 403 for a missing key: the role can't list) | #370 |
| A unit of work replaces pooled connections Neon closed while the Lambda was frozen (the 500s after idle) | #357 |
| Dev's API reserves 20 concurrent executions (10 throttled parallel e2e runs: the 503s) | #364 |
| `premium-live-check.mjs` (K4) and `demo-premium.mjs` (K5, test-studio-1 and -2 dressed with rooms, instructors, photos, a buddy pair, sales, arrivals) | #361 |
| E10 on dev: `sync8` (buddies, spots, the scan, the live map) at 360 and 1280 px | O4 #366 |
| Performance: the member home's layout shift (CLS 0.107) gone (the promotion is a toast); the console today keeps its summary line while loading. Every measured page now under CLS 0.1 and LCP 2.5 s on dev | O5 #365, #376 |
| The regression run of `screens` and sync2 to sync7 on dev, and its fixes (inline links underlined, the folded tab bar's names, the toast's close button at 44 px, the pressed secondary button) | O0 #350 #353 #363 #355 |
| The today page as one compact table; the mockup comparison (O6), the larger gaps in #378 | #367; #377 |
| White label plan, W-1 to W-12 with defaults, build steps WL1 to WL6 | K6 #362 (`docs/35`) |

- Migrations on dev went up to **0031** on that board (the current number is in the next section).
- Running the .NET tests on this machine: Smart App Control also blocked Debug DLLs on 2026-10-18; run them in the
  `mcr.microsoft.com/dotnet/sdk:10.0` container (local-dev-quirks.md).

## White label, branded sign-in, studio marketing and share links (2026-10-19 to 2026-10-21, boards #380, #404, #445)

Specs: `docs/35` (white label, D21), `docs/36` and ADR-0028 (branded sign-in, D22), `docs/37` (marketing, D23; share
links D25 and the public surface's protections D24 in its section 12). Epic #432 tracks marketing.

| Piece | PR |
|---|---|
| White label: the brand row, pictures and icon sizes (WL1, migration 0032), the eight accents (WL2), brand settings with a home-screen preview (WL3), a studio's public manifest and icons (WL4), a studio's own app at `/s/<slug>/` and the switcher (WL5), client links into that app and `GET /public/studios/{slug}/brand` (K-WL5) | #384, #382, #405, #387, #402, #406, #427 |
| Branded sign-in over Cognito `USER_AUTH` (password and passkey; the email code waits for SES, #304), behind `branded_login`, on for the dev members app since #440; the passkey relying party is named in config | #385, #386, #399, #400, #401, #428, #440 |
| Marketing stage A: schema and settings (MK1), the public studio page with sessions as buckets (MK2), open join, the intro pass and sources (MK3), links with source codes and the source report (MK4), story suggestions (MK5); the console's public page settings, story generator, suggestion cards and source report (MO2 to MO4) | #389 to #395, #408, #412, #414, #416 |
| Marketing stage B backend: schema and the `celebrations` group (MK7, migration 0035), a member's share links, milestones and the bring-a-friend reward (MK8a), events without a pass and the event-week reminder (MK8b); one reward under concurrent marks | #396, #397, #398, #407 |
| Share links by intent (SL-1 to SL-10): schema (migration 0036), public products, the offer read and alternatives, the offer join in one transaction, link targets, the public link lookup, the invite's first name and preview covers, the live check; the class page, the sheet sign-up, offer and prices pages, the target picker, in-app browsers, a member's invite, link previews through `_worker.js` | #413, #424, #425, #426, #433, #418, #420, #437, #436, #434, #438, #439 |
| The public surface's protections (S-A to S-D): route throttling below the API's concurrency, per-address and per-account counters (migration 0037), staff links can't use members' channels, `private, no-store` by default, the same 404 for unknown and suspended studios, app-side security tests | #417, #419, #421, #422, #423, #435 |
| #374: the plain check-in secret column dropped (migration 0033); the spot-opened story keyed on the cancel time (migration 0038) | #415, #429 |
| Performance: hashed build files cached for a year on Pages; ReadyToRun (it did not move the cold start) | #410, #411 |
| Board #445: the bring-a-friend reward on a member's referral link (R-1) and no inviter name made from an email; the O4 and O1 runs on dev | #450, #444, #446 |
| Board #445 apps: the copied link on the share button, "מחירים" only with listed products (P-3), the Hebrew-first name hint, the studio's brand on its sign-in and side nav (WL5 part B), the sign-in run | #447, #448, #449, #451, #452 |
| Board #445 stage B apps (B-1): the invite's reward line, "הביאי חברה" (opening never changes her name switch, SL-8), the `celebrations` switch, the milestone card and notices, events in the console and on the public page, the roster's "לתשלום בסטודיו" (`RosterEntry.toPayAtStudio`), the A4 poster with a QR | #453, #457, #455, #460, #461, #462, #465, #469, #463 |
| Board #445 cold start (P-1): the first-request timeline (log line `cold start` and X-Ray subsegments), routing measured, then the Request Delegate Generator and an Init warm-up | #454, #464, #466 |

- **Migrations on dev go up to 0038** (0033 to 0038 all applied); **0039** is the next free number.
- **The cold start went from about 8.4 s to 3.5 s** (from Israel, 11 parallel cold `GET /me` on dev, #445 tables 1
  to 3). Building every minimal API endpoint on the first request took 2.9 to 3.9 s; the Request Delegate Generator
  and building them in Init cut routing to 0.2 s. The JWKS fetch and the SSM read start in Init. Left: 1.3 s of
  sandbox and package, 1.0 s Init, 1.0 s endpoint (the first Neon connection stays out of Init so `/health` never
  wakes Neon). Further gains cost money (N-4).
- MO7's highlight covers (#467) and instructor story (#468) wait for a merge of `main` and a new review (#467 went
  CONFLICTING after #463's squash).
- Pages Functions on `/s/*` count against Cloudflare's free 100,000 requests a day (the link previews, SL-9): a
  tripwire row in ADR-0021.
- R-1's wording on the invite page: the reward goes to the member only (M-17), so the line says "כשתגיעי לשיעור
  הראשון, <name> מקבלת <product>" rather than promising the friend anything (#445, agreed by [O]).

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
| The real logo | The icons use K1's redraw of LOGO1.png as a temporary logo (Kris, 2026-10-18) |
| `docs/35` W-1 to W-12 (white label) | Defaults apply unless Kris changes them; then WL1 to WL6 |
| `s3:ListBucket` on `incoming/*` for the API role | Optional IAM change; #370 works without it |
| Instagram story and WhatsApp preview test on a real phone (#404, #445) | Then O5 and K6 clean the O4 seed and [K]'s Hebrew offer in tempo-smoke-studio |
| P-2: tighter read throttling on dev (rate 5, burst 6) | Rates stay at reads 10/12 and join 2/4 until Kris answers (#445) |
| #304 email domain and sender | Unlocks the email code and the passwordless sheet (docs/36) |

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

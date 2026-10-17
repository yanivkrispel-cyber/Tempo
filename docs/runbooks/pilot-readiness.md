# Runbook: pilot readiness

Written on 2026-10-17 (day board #232, R1) and updated the same afternoon (board #253, U6) and evening (board #321,
U7). It lists every step a
real studio goes through on Tempo. Each step is
marked **done on dev**, with the PR that shipped it, or **blocked on Kris**, with the item that blocks it. The how-to
for each step is in `docs/runbooks/pilot-onboarding.md`. This page answers a different question: can a studio
start tomorrow, and if not, what stops it?

The pilot runs on the development environment. Production waits for revenue (ADR-0021).

## Verdict

A studio can run end to end on dev today, and since #310 the apps are on the internet as well:
https://tempo-studio-console.pages.dev and https://tempo-members.pages.dev (Cloudflare Pages, ADR-0027; AWS refused
CloudFront). Two things stop a real pilot, and both need Kris: the health form's wording with the lawyer (P-2), and
the consent texts (P-4).

Since board #321 every console works on a phone and on a computer (D15, #318 and #320, with K2's after-merge
review and #328), the owner can import the member list from a CSV file, and staff keep notes and tags on a person.

Since board #253 the console has owner reports, a person can delete their own login, and the operator can remove
a suspended studio. The last two close P2 F6 and F4 once Kris registers as operator (Kris's list, step 1).

## The studio's path

| # | Step | State | Where |
|---|---|---|---|
| 1 | The operator account (the Tempo team) | **blocked on Kris**: register as the first operator (MFA) | `tools/scripts/register-operator.ps1` |
| 2 | The owner signs up and creates the studio | done on dev | Phase 1, #30 to #43 |
| 3 | The free `pilot` plan, entitlements, restricted mode | done on dev | #105, #174 |
| 4 | Two-step sign-in for owners and staff | done on dev; `TEMPO_REQUIRE_OWNER_MFA` stays off until owners enroll | #127, #150 |
| 5 | Staff invited, roles and permissions | done on dev | Phase 2, #61 to #88 |
| 6 | Rooms, class types, weekly classes, the eight-week horizon; ending a class created by mistake | done on dev | #95, #100, #148; #250 |
| 7 | Pass products granted at the desk (no online payment) | done on dev | #95, #158 |
| 8 | Members: a record each, invited or by the join link | done on dev | #88 |
| 9 | The health declaration: sign, status, answers (`health.view`), medical approval, the booking gate | done on dev; **the wording is a draft until P-2** | H2 #239, screens X2 #237 and X3 #238 |
| 10 | Booking, waitlist with promotion, moves, freezes, add to calendar | done on dev | #95, #154, #157, #158 |
| 11 | Notifications: inbox, web push, reminders, templates, announcements | done on dev; email waits for the domain (D-1) | docs/30 steps 1 to 4, 6, 7 (#176, #208) |
| 12 | Attendance and the member's progress (visits, goal, streak) | done on dev | #95; P1 #235, X1 #236 |
| 13 | Export and erase, including the health declaration; the export still goes out, answers withheld, when the health key can't be read | done on dev | #61 to #90; #239; A3 #264 |
| 13a | Owner reports: weekly figures, per class type, active and new members; passes ending soon and members at risk (`reports.view`, migration 0021) | done on dev, API and console page | R2 #259; Y0 #256, Y1 #257 |
| 13b | A person deletes their own login; each studio keeps the person record and its history (migration 0022) | done on dev, API (live check 5/5) and both apps; Playwright `sync6` 6/6 | A1 #262, #267; Y2 #258; Y3 #261 |
| 13c | The operator removes a suspended studio and every row it owns (migration 0023) | built; **needs the operator** (Kris's step 1) | A2 #263 |
| 13d | The owner imports the member list from a CSV file: a check first, then the import; people already in the studio are left alone; an optional tag for the batch (migration 0024) | done on dev, API; the console page is K2's Z1 | I1 #323, I2 #325, I3 #329 |
| 13e | Staff notes and the studio's tags on a person; the people list filters by tag; erase, merge and export carry them (migration 0025) | done on dev, API; the console screens are K2's Z2 | N1 #327 |
| 13f | Every console on a phone, a tablet and a computer, and the coach's "today" screen (D15) | done on dev; merged without a review at 18:10, then reviewed after the merge | #318, #320, #328 |
| 14 | Consent texts shown to members | **blocked on Kris**: P-4 | docs/27 section 15 |
| 15 | The apps on the internet (Cloudflare Pages, ADR-0027; AWS refused CloudFront on 2026-10-17) | done on dev: `deploy-web` publishes and smoke-tests both apps on every deploy since the secrets were set | #310 |

## Found in the pilot dry run (P2)

K2 ran a new studio end to end in the browser at phone width on 2026-10-17 (#232, P2). The run used two fresh
Cognito users (`e2e-p2-owner-…`, `e2e-p2-member-…@example.com`), which were deleted afterwards. It went through:
1. the owner opens a studio;
2. room, class type, punch card, a weekly class;
3. the member is recorded, invited and granted a card, then joins;
4. the member signs the declaration and books;
5. staff send a message and it reaches the inbox;
6. staff mark attendance, and the member's home shows one visit and a one-week streak.
All seven steps were green on the last run.

| # | Finding | State |
|---|---|---|
| F1 | A new owner's first screen failed axe contrast (empty-state text 4.3:1) | fixed in #249 |
| F2 | A tall dialog (the seven answers) pushed its buttons off a phone | fixed in #247 |
| F3 | The fixed tab bar hid a focused field near the bottom of a form (WCAG 2.4.11) | fixed in #247 |
| F4 | **A studio could not be removed.** Seven e2e studios are left on dev: six `e2e-p2-…` from the dry run and one `e2e-sync6-…` from Y3 (each sync6 run adds one). | path in place: A2 #263 removes a suspended studio, and `tools/scripts/e2e-cleanup.mjs --apply` (A4 #266) suspends and removes them; **blocked on Kris**: the operator token |
| F5 | A weekly class created by mistake could only end on its first day | fixed in #250 (an unbooked class ends before its first day; migration 0019) |
| F6 | No API removed an account | path in place: `DELETE /me` (A1 #262) for any login that can still sign in. **Kris**: 14 e2e account rows whose Cognito users are gone (listed by `e2e-cleanup.mjs`; each sync6 run adds its owner's) need an operator route or a one-off SQL on dev |
| F7 | Push not checked: headless Chromium has no push service (the inbox item arrived) | **Kris**: one manual check on a phone with client-web installed |
| F8 | Once in five runs, a console page stayed on its skeleton for over 15 s (cold start, or the concurrency cap of 10) | noted; E-4 keeps the cap |

The H5 live check and the `sync5` Playwright run leave fictional data on dev on purpose. Each `sync5` run leaves the
smoke user's own declaration, answered "yes" on the generic draft questions, and the next run replaces it. The H5
member is erased after its run. Neither is real health data.

## Open follow-ups (not blocking a pilot)

- Staff notes go into a person's export (docs/34 section 9, a **(reading)**): confirm with the lawyer under P-2.
- A future CSV export must escape values that start with `=`, `+`, `-` or `@` (docs/34 section 6).
- #322, #324 and #326 (the design session's Studio Experience plan, docs/33) were opened outside board #321 and
  claimed migrations 0024 and 0025, which the board used; their migrations move to 0026 and up.

| Item | Where |
|---|---|
| CloudFront minimum TLS 1.2 with the domain | #241 |
| `trustPolicy: no-downgrade` for pnpm: the frozen install fails on `semver@6.3.1` and `undici-types@6.20.0` (trust downgrade) | #115 |
| `minimumReleaseAge` is one day, not Semgrep's seven: seven rejects 9 lock entries from this week | #265 |
| A removed studio's rows stay in Neon's point-in-time history until it ages out (6 h on the Free plan); the production deletion promise must say so | A2 review, #263 |
| Until #261, `expectFitsNarrowPhone` could not fail on the Pixel 7 projects (`innerWidth` grows with a page that is too wide), so the next sync2 to sync5 and design-system runs may show sideways scroll that was always there | Y3 #261 |
| Where `admin-web` lives beside `client-web` on the one distribution | K2's CSP review, #232 |
| A production copy of the health data key (offline backup, or not) | docs/31 section 15 |

## Kris's list

1. Register as the first operator (`tools/scripts/register-operator.ps1`, MFA).
2. The health form's wording and the retention rule with the lawyer (P-2); the consent texts (P-4).
3. Done: the Cloudflare secrets are set and `deploy-web` publishes both apps (#310).
4. IAM grants so CI's smoke test can sign in; confirm the canary's SNS email.
5. #115: `trustPolicy` for pnpm (exclude the two packages, refresh their lock entries, or accept the finding). The
   Actions pins of #186 are done (W1 #254).
6. After registering as operator, run `TEMPO_OPERATOR_TOKEN=… node tools/scripts/e2e-cleanup.mjs --apply` to remove
   the seven e2e studios (P2 F4), and decide how the 14 orphaned e2e account rows go (F6).
7. One push check on a real phone (P2 F7).
8. The two report rules marked **(reading)** in docs/32 section 6, and `TEMPO_STUDIO_REMOVAL_MIN_DAYS` (30 days by
   default outside dev) before production.

# Runbook: pilot readiness

Written on 2026-10-17 (day board #232, R1) and updated the same afternoon (board #253, U6) and evening (board #321,
U7), then on 2026-11-03 (board #584, K8: the P3 dry run's API side and the pilot sprint) and on 2026-11-06 (board #612: final states and the P3 rerun). It lists every step a
real studio goes through on Tempo. Each step is
marked **done on dev**, with the PR that shipped it, or **blocked on Kris**, with the item that blocks it. The how-to
for each step is in `docs/runbooks/pilot-onboarding.md`. This page answers a different question: can a studio
start tomorrow, and if not, what stops it?

The pilot runs on the development environment. Production waits for revenue (ADR-0021).

## Verdict

**Board #584 (2026-11-03):** the P3 dry run (owner and member, phone and computer, against dev) found **no blocker
and no API error**: 1,199 API requests, none failed. What stops a real studio is still not code, and each piece is
now a short step for Kris in `docs/runbooks/kris-pilot-steps.md` (#596): the lawyer session with the drafts in
`docs/legal/` (#594: the health form P-2, the consents P-4, the privacy policy and terms #548), the support contact
(one SSM parameter, #597), the phone test (#305), and three candidate studios with the pilot kit in `docs/pilot/`
(#593). A studio can now bring its members' paid passes (`importPasses`, docs/40, #598), and the owner's first hour
is guided by the setup checklist (#586).

A studio can run end to end on dev today, and since #310 the apps are on the internet as well:
https://tempo-studio-console.pages.dev and https://tempo-members.pages.dev (Cloudflare Pages, ADR-0027; AWS refused
CloudFront). Two things stop a real pilot, and both need Kris: the health form's wording with the lawyer (P-2), and
the consent texts (P-4).

Since board #321 every console works on a phone and on a computer (D15, #318 and #320, with K2's after-merge
review and #328), the owner can import the member list from a CSV file, and staff keep notes and tags on a person.

Since board #253 the console has owner reports, a person can delete their own login, and the operator can remove
a suspended studio. The last two close P2 F6 and F4 once Kris registers as operator (Kris's list, step 1).

## The studio's path

| #   | Step                                                                                                                                                                           | State                                                                                                    | Where                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | The operator account (the Tempo team) | **most likely done**: an active operator row matches a pool user (2026-11-03); Kris signs in with `operator-token.mjs` | `tools/scripts/register-operator.ps1`, `tools/scripts/operator-token.mjs` (#596) |
| 2   | The owner signs up and creates the studio                                                                                                                                      | done on dev                                                                                              | Phase 1, #30 to #43                     |
| 3   | The free `pilot` plan, entitlements, restricted mode                                                                                                                           | done on dev                                                                                              | #105, #174                              |
| 4   | Two-step sign-in for owners and staff                                                                                                                                          | done on dev; `TEMPO_REQUIRE_OWNER_MFA` stays off until owners enroll                                     | #127, #150                              |
| 5   | Staff invited, roles and permissions                                                                                                                                           | done on dev                                                                                              | Phase 2, #61 to #88                     |
| 6   | Rooms, class types, weekly classes, the eight-week horizon; ending a class created by mistake                                                                                  | done on dev                                                                                              | #95, #100, #148; #250                   |
| 7   | Pass products granted at the desk (no online payment)                                                                                                                          | done on dev                                                                                              | #95, #158                               |
| 8   | Members: a record each, invited or by the join link                                                                                                                            | done on dev                                                                                              | #88                                     |
| 9   | The health declaration: sign, status, answers (`health.view`), medical approval, the booking gate                                                                              | done on dev; **the wording is a draft until P-2**                                                        | H2 #239, screens X2 #237 and X3 #238    |
| 10  | Booking, waitlist with promotion, moves, freezes, add to calendar                                                                                                              | done on dev                                                                                              | #95, #154, #157, #158                   |
| 11  | Notifications: inbox, web push, reminders, templates, announcements                                                                                                            | done on dev; email waits for the domain (D-1)                                                            | docs/30 steps 1 to 4, 6, 7 (#176, #208) |
| 12  | Attendance and the member's progress (visits, goal, streak)                                                                                                                    | done on dev                                                                                              | #95; P1 #235, X1 #236                   |
| 13  | Export and erase, including the health declaration; the export still goes out, answers withheld, when the health key can't be read                                             | done on dev                                                                                              | #61 to #90; #239; A3 #264               |
| 13a | Owner reports: weekly figures, per class type, active and new members; passes ending soon and members at risk (`reports.view`, migration 0021)                                 | done on dev, API and console page                                                                        | R2 #259; Y0 #256, Y1 #257               |
| 13b | A person deletes their own login; each studio keeps the person record and its history (migration 0022)                                                                         | done on dev, API (live check 5/5) and both apps; Playwright `sync6` 6/6                                  | A1 #262, #267; Y2 #258; Y3 #261         |
| 13c | The operator removes a suspended studio and every row it owns (migration 0023)                                                                                                 | built; **needs the operator** (Kris's step 1)                                                            | A2 #263                                 |
| 13d | The owner imports the member list from a CSV file: a check first, then the import; people already in the studio are left alone; an optional tag for the batch (migration 0024) | done on dev, API; the console page is K2's Z1                                                            | I1 #323, I2 #325, I3 #329               |
| 13e | Staff notes and the studio's tags on a person; the people list filters by tag; erase, merge and export carry them (migration 0025)                                             | done on dev, API; the console screens are K2's Z2                                                        | N1 #327                                 |
| 13f | Every console on a phone, a tablet and a computer, and the coach's "today" screen (D15)                                                                                        | done on dev; merged without a review at 18:10, then reviewed after the merge                             | #318, #320, #328                        |
| 13g | The setup checklist on the console's home: nine first steps, each read from a list the console already loads (PL-3) | done on dev | O2 #586 |
| 13h | Pass import: the passes a studio's members already paid for, from a CSV file, a check first, then the import (migration 0041) | done on dev: API #598, console page #611; PI-8 (a frozen imported pass is found by a re-run) #624 | docs/40 #591, contract #592, #598 |
| 13i | "עזרה ויצירת קשר": the Tempo team's contact and the FAQ in the console (PL-4) | done on dev: API #597, console page #606; the contact is read from SSM `/tempo/dev/support/contact`, which Kris sets. The page reads `docs/pilot/faq.md` at build, and `paths-ignore` skips `docs/**`, so a FAQ edit reaches the app only with the next app deploy | #595, #597; `docs/pilot/faq.md` |
| 14  | Consent texts shown to members | **blocked on Kris**: P-4; the draft for the lawyer is in `docs/legal/` | docs/27 sections 4.3 and 14 (there is no section 15); #594 |
| 15  | The apps on the internet (Cloudflare Pages, ADR-0027; AWS refused CloudFront on 2026-10-17)                                                                                    | done on dev: `deploy-web` publishes and smoke-tests both apps on every deploy since the secrets were set | #310                                    |

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

| #   | Finding                                                                                                                                                        | State                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | A new owner's first screen failed axe contrast (empty-state text 4.3:1)                                                                                        | fixed in #249                                                                                                                                                                                                                                        |
| F2  | A tall dialog (the seven answers) pushed its buttons off a phone                                                                                               | fixed in #247                                                                                                                                                                                                                                        |
| F3  | The fixed tab bar hid a focused field near the bottom of a form (WCAG 2.4.11)                                                                                  | fixed in #247                                                                                                                                                                                                                                        |
| F4  | **A studio could not be removed.** Seven e2e studios are left on dev: six `e2e-p2-…` from the dry run and one `e2e-sync6-…` from Y3 (each sync6 run adds one). | path in place: A2 #263 removes a suspended studio, and `tools/scripts/e2e-cleanup.mjs --apply` (A4 #266) suspends and removes them; **blocked on Kris**: the operator token                                                                          |
| F5  | A weekly class created by mistake could only end on its first day                                                                                              | fixed in #250 (an unbooked class ends before its first day; migration 0019)                                                                                                                                                                          |
| F6  | No API removed an account                                                                                                                                      | path in place: `DELETE /me` (A1 #262) for any login that can still sign in. **Kris**: 14 e2e account rows whose Cognito users are gone (listed by `e2e-cleanup.mjs`; each sync6 run adds its owner's) need an operator route or a one-off SQL on dev |
| F7  | Push not checked: headless Chromium has no push service (the inbox item arrived)                                                                               | **Kris**: one manual check on a phone with client-web installed                                                                                                                                                                                      |
| F8  | Once in five runs, a console page stayed on its skeleton for over 15 s (cold start, or the concurrency cap of 10)                                              | noted; E-4 keeps the cap                                                                                                                                                                                                                             |

The H5 live check and the `sync5` Playwright run leave fictional data on dev on purpose. Each `sync5` run leaves the
smoke user's own declaration, answered "yes" on the generic draft questions, and the next run replaces it. The H5
member is erased after its run. Neither is real health data.

## Found in the pilot dry run (P3)

Board #584, O5 (decision PL-6), on 2026-11-03. Playwright project `pilot-p3` (`tests/e2e/specs/pilot-p3/`) drives the
screens only, with one fresh owner (1280px, then 390px) and one fresh member (Pixel 7), both `e2e-p3-…@example.com`,
against dev. The owner signs in, opens the studio, sets the brand, adds a room, a class type, a punch card and a weekly
class nine minutes ahead, and makes the join link; the member opens the link and joins; the owner gives the pass on the
person card; the member books; the owner marks them attended. It passed (4 of 4, axe clean on every screen, the owner's
eight console screens fit 390px). The numbers come from `test-results/pilot-p3/metrics.json`; every `click`, `tap`,
`check` and `uncheck` the spec performs is counted, typing is not. Minutes are a machine's pace (the dev API answered
fast), a floor and not a person's time.

| Milestone                    | Minutes | Clicks (owner + member) |
| ---------------------------- | ------- | ----------------------- |
| (a) first weekly class saved | 0.2     | 19 + 0                  |
| (b) first member joined      | 0.4     | 25 (22 + 3)             |
| (c) first attended booking   | 0.5     | 35 (29 + 6)             |

The run leaves one `e2e-p3-…` studio on dev for `tools/scripts/e2e-cleanup.mjs` (A-4); the Cognito users are deleted.

| #     | Finding                                                                                                                                                                                                                                                                                                                                                                    | Severity | Side                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| P3 F1 | **No guidance after "פתיחת הסטודיו".** The first screen is the members table with the owner alone; nothing says that a first class needs a room, a class type and (for booking) a pass, or where the join link is. The owner has to know seven screens in order (settings, rooms, class types, passes, schedule, invitations, people). A first-steps checklist is the fix. | high     | app (admin-web)                                                   |
| P3 F2 | **The join link is under "הזמנות", a menu item named for email invitations.** It shows once, with no QR and no share button, and a new link cancels the old one. An owner who wants "the link for my members" is not pointed to it; the public page (Settings) has a link and a QR but is a different thing (docs/37).                                                     | medium   | app (admin-web)                                                   |
| P3 F3 | **A member who joins by the link has no name.** The person card shows first and last name as "—", the roster and the people list show the email prefix, and the member app greets "בוקר טוב, e2e-p3-member-…". Neither the join page nor the Hosted UI asks for a name.                                                                                                    | medium   | app (client-web) and API (join creates the person from the email) |
| P3 F4 | **A joined member can't book until the owner finds them in "אנשים" and gives a pass** ("מתן כרטיסייה או מנוי"); nothing tells the owner a person has joined and waits for one. 6 of the 35 clicks.                                                                                                                                                                         | medium   | app (admin-web notice)                                            |
| P3 F5 | **A new room opens its map dialog at once (D20).** The owner has to take or leave it before anything else works (the scrim blocks the menu): one more click and a screen the owner did not ask for in a first run.                                                                                                                                                         | low      | app (admin-web)                                                   |
| P3 F6 | **Toasts from earlier screens stack** (three at once on the invitations screen: class type, product, class) and follow the owner to the next screens.                                                                                                                                                                                                                      | low      | app (admin-web)                                                   |
| P3 F7 | **The booking confirmation toast was not found** by the test (the member's list shows "נרשמת" inline). Not confirmed as a defect: check by hand on a phone that a toast shows.                                                                                                                                                                                             | low      | app (client-web), to confirm                                      |
| P3 F8 | 19 clicks over seven screens to the first class is a lot for a first session; the join link and the first class are the natural first two steps of a guided setup (see F1). Brand and room are not needed to take the first booking; the pass product is (docs/42).                                                                                                        | medium   | app (admin-web)                                                   |

No blocker found: nothing in the path was impossible, and no API error was hit.

### P3 on the API side (K8)

[K] read the API's request log for the P3 window (2026-11-03 05:15Z to 06:05Z, Logs Insights on
`/aws/lambda/tempo-dev-api`, `RequestPath` without the query string, #557):

| What | Value |
|---|---|
| Requests | 1,199 (1,139 answered 200, 60 answered 201) |
| 4xx or 5xx a person would hit | **none** |
| Handler time, all routes | p50 60 ms, p95 327 ms |
| Slowest single calls | 1.0 to 1.3 s, the first call of a new Lambda instance (cold start) on `sessions`, `schedule-templates`, `pass-products` and the settings reads |

No API finding. The cold start shows up on the first screen after a quiet minute, which is what P-1 (board #445) measured:
about 3.5 s before the first byte on a fully cold instance, under 1.3 s here because the run kept instances warm.

| # | Finding | State after board #584 |
|---|---|---|
| P3 F1 | No guidance after opening the studio | fix: the setup checklist, #586 (O2) |
| P3 F2 | The join link is hidden under invitations, shown once, no QR | fix: #589 (confirm before replacing, QR, share) |
| P3 F3 | A member who joins by link has no name | app-side only: #604 asks "איך קוראים לך?" and saves it with `PATCH /me` before joining (no API change) |
| P3 F4 | Nothing tells the owner that a member joined and needs a pass | API: #599 (`joined_without_pass` card; a used-up card counts as no pass); the console card is #625 |
| P3 F5 | A new room opens its map at once | kept: D20 is Ofir's decision |
| P3 F6 | Toasts stack up | fix: #588 (three at most) |
| P3 F7 | Booking toast not found by the test | confirmed by `pilot-p3`, no phone needed: no message on the timetable in a room with a map (#640) |
| P3 F8 | 19 clicks to the first class | product question for Kris and Ofir; options in `docs/42_First_Class_Clicks_Note.md` |

### P3 again on the final `main` (board #612, O6)

Run `mw57w00d` on `main` `f903c0a`, on 2026-11-06: 5 of 5 passed in 2.0 min, no blocker. The only accessibility notes
are #626. The run adds one step, the pass import, after the old marks so they stay comparable.

| Milestone | Clicks on #584 | Clicks now |
|---|---|---|
| First weekly class | 19 | 19 |
| First member joined | 25 | 25 |
| First attended booking | 35 | 35 |
| Passes imported (new step) | none | 41 (owner 35, member 6) |

Minutes are machine pace and moved between runs the same day, so they say nothing about a person's time.

After numbers (`tests/e2e/perf/after-2026-11-06.json`, median of 3, Pixel 7, Slow 4G, CPU 4x) against 2026-10-27, as
the average of ten screens: LCP on a first visit 2,719 to 2,482 ms, API done 3,305 to 2,861 ms, LCP on a repeat visit
909 to 700 ms. The files are ten days apart, so small moves may be noise. One regression: the member profile, 2,632 to
3,404 ms LCP on a first visit (#628, not a blocker). A first visit sends 2 to 8 CORS preflights per screen and a repeat
visit none, so `docs/39`'s default stands.

## Open follow-ups (not blocking a pilot)

From board #584:

- **No whole-studio export**, only one person at a time. The pilot offer promises the data back at the end, so for
  now the team prepares it by hand.
- **No screen records that a member accepted the terms** (`docs/legal/questions-for-lawyer.md`, question 20).
- The member app shows no **studio's own contact**: it needs a settings field, a contract and a migration, so it
  waits until after the pilot (O4, member side).
- From the #600 review: `find_account_profiles` could give removed or suspended members' names without their email,
  which needs a migration, so it is on Kris's list. The invitation preview read by a caller outside the studio has its integration test (#619).
- On dev a suspended studio can be removed after 0 days (`TEMPO_STUDIO_REMOVAL_MIN_DAYS`).

- Staff notes go into a person's export (docs/34 section 9, a **(reading)**): confirm with the lawyer under P-2.
- A future CSV export must escape values that start with `=`, `+`, `-` or `@` (docs/34 section 6).
- #322, #324 and #326 (the design session's Studio Experience plan, docs/33) were opened outside board #321 and
  claimed migrations 0024 and 0025, which the board used; their migrations move to 0026 and up.

| Item                                                                                                                                                                                                                           | Where                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| CloudFront minimum TLS 1.2 with the domain                                                                                                                                                                                     | #241                  |
| `trustPolicy: no-downgrade` for pnpm: the frozen install fails on `semver@6.3.1` and `undici-types@6.20.0` (trust downgrade)                                                                                                   | #115                  |
| `minimumReleaseAge` is one day, not Semgrep's seven: seven rejects 9 lock entries from this week                                                                                                                               | #265                  |
| A removed studio's rows stay in Neon's point-in-time history until it ages out (6 h on the Free plan); the production deletion promise must say so                                                                             | A2 review, #263       |
| Until #261, `expectFitsNarrowPhone` could not fail on the Pixel 7 projects (`innerWidth` grows with a page that is too wide), so the next sync2 to sync5 and design-system runs may show sideways scroll that was always there | Y3 #261               |
| Where `admin-web` lives beside `client-web` on the one distribution                                                                                                                                                            | K2's CSP review, #232 |
| A production copy of the health data key (offline backup, or not)                                                                                                                                                              | docs/31 section 15    |

## Kris's list

Since board #584 each step below has its exact commands in `docs/runbooks/kris-pilot-steps.md`.

1. The operator: most likely registered already. Sign in with `tools/scripts/operator-token.mjs` and run the e2e
   clean-up (32 `e2e-…` studios on 2026-11-03).
2. The health form's wording and the retention rule with the lawyer (P-2); the consent texts (P-4).
3. Done: the Cloudflare secrets are set and `deploy-web` publishes both apps (#310).
4. IAM grants so CI's smoke test can sign in; confirm the canary's SNS email.
5. #115: `trustPolicy` for pnpm (exclude the two packages, refresh their lock entries, or accept the finding). The
   Actions pins of #186 are done (W1 #254).
6. The e2e clean-up: `node tools/scripts/operator-token.mjs -- node tools/scripts/e2e-cleanup.mjs --apply` (step 1),
   then decide how the orphaned e2e account rows go (P2 F6).
7. One push check on a real phone (P2 F7).
8. The two report rules marked **(reading)** in docs/32 section 6, and `TEMPO_STUDIO_REMOVAL_MIN_DAYS` (30 days by
   default outside dev) before production.
9. The support contact: one `aws ssm put-parameter` (`kris-pilot-steps.md` step 2).
10. Three candidate studios (kept outside the repo), the pilot offer (`docs/pilot/pilot-offer.md`), and P3 F8.

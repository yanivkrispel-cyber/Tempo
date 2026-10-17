# Runbook: bringing a pilot studio on board

Written on the night of 2026-10-15 (board #136, B6) for the first studios on the free `pilot` plan. Every step
names who does it (the operator, the studio owner, or an agent) and what is still manual. Nothing here touches
production: the pilot runs on the development environment until the edge (CloudFront) is verified and a domain
exists (docs/claude-memory/project-status.md, "Open items for Kris").

## Before the first studio (once)

| Step | Who | How | Status |
|---|---|---|---|
| Register the first operator | Kris, by hand (MFA) | `tools/scripts/register-operator.ps1 -Email <address>`; paste the printed `INSERT` into the Neon SQL editor as the owner; first sign-in sets a new password and a TOTP device | open |
| Consent texts (P-4) | Kris writes them in Hebrew; a lawyer checks | docs/27 section 15; the texts are product decisions, not code | open |
| Retention of archived people (P-2) | Kris confirms with an accountant | seven years is the default | open |
| CloudFront edge on dev | AWS (support case 179198465900800) | until then the apps run locally against the dev API | open |
| Alarm email confirmed | Kris | click the AWS "Subscription Confirmation" email of `tempo-dev-api-canary` once | open |

## Running the apps for a demo

The dev API: `https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com`. Both apps run locally against it:

```text
cp apps/admin-web/.env.example apps/admin-web/.env.local   # fill VITE_API_URL, VITE_COGNITO_DOMAIN, VITE_COGNITO_CLIENT_ID
pnpm --filter @tempo/admin-web dev
pnpm --filter @tempo/client-web dev                          # same three variables, client-web app client
```

For a demo without a real studio, seed the fixture studio and remove it afterwards (`tools/scripts/demo-studio.mjs`,
night board #136, B1): two rooms, four class types, eight weekly classes, three pass products, twelve fictional
members, one class full with a waitlist.

```text
node tools/scripts/demo-studio.mjs seed    --profile tempo
node tools/scripts/demo-studio.mjs clean   --profile tempo
```

## The studio owner's path (self-onboarding, docs/26 D7)

1. **Sign up.** The owner opens the console (admin-web) and signs up with the Hosted UI: email, password, verified
   email. No invitation is needed for an owner.
2. **Create the studio.** `POST /api/v1/organizations` from the console: display name, slug, time zone (default
   `Asia/Jerusalem`), locale (`he-IL`). The creator becomes the owner; the owner role is set only here and never by
   invitation (docs/26 section 6). The studio starts on the `pilot` plan with an **active** subscription (docs/28):
   entitlements apply (rooms, staff and so on), no payment provider, no trial clock.
3. **Two-step sign-in.** Recommended for owners and staff: console, account security page, TOTP (admin-web #127;
   the `VITE_COGNITO_MFA_SETUP` flag and the `COGNITO_ADMIN` scope of #134 must be on in that environment).
   `TEMPO_REQUIRE_OWNER_MFA` stays off until every owner has enrolled.
4. **Invite the team.** Console, members: invitations by email for `admin` and `staff` (docs/26 section 8); one
   pending invitation per address, expiry per policy; `staff.max` counts live invitations and ignores expired ones
   (#125). The invitation link is shown to the inviter to share; there is no email delivery until Phase 4.
5. **Rooms, class types, weekly classes.** Console, schedule: rooms with a default capacity, class types with a
   category, color and length, then weekly classes (weekday 0 = Sunday, local start time, room, capacity). The API
   materializes eight weeks of sessions at once and keeps the horizon every night (`scheduling.daily`, 03:15
   Israel time).
6. **Pass products.** Console, passes: punch cards (entries, validity in days) and memberships (validity, weekly
   cap), optional class category and price in agorot. Members do not pay in the app; the desk sells and **grants**
   the pass by hand (docs/29 section 5.2). Online payment is Phase 6.
7. **People and members.** Console, people: a record per member (name, email or phone). To let a member use the
   app, invite the recorded person (#88); when they accept, the person and the membership are linked. Members can
   also join through the studio's join link (`PUT /join-link`), which the owner shares.

   **Bringing an existing member list (docs/34):** console, people, **Import** (owner and admin, `people.import`).
   Save the list from Excel as **CSV UTF-8** (or plain CSV on a Hebrew Windows; both are read), one person per row
   with a header row. The console proposes which column is the name, phone, email and birth date. **Check** first:
   it shows every row as valid, already in the studio, repeated in the file, or invalid with the reason, and writes
   nothing. **Import** then creates the valid rows; running the same file again creates nothing new. At most 1,000
   rows per file. The import records no marketing consent and sends nothing: invite people from their card as above.
   Tip: create a tag first (for example "ייבוא 17.10") and give it to the whole batch.
7a. **Tags and staff notes.** Console, settings, Tags (owner and admin): the studio's labels, up to 100. On a person's
   card, staff put tags on and write short notes ("prefers the front row"). **Never write health information in a
   note**: it belongs in the health declaration. A person who asks for their data gets the notes in the export.
8. **Booking policy.** Console, settings: free-cancellation window (default 6 hours, C-1), booking horizon (14
   days, C-4), waitlist on or off and its cutoff (2 hours). Defaults apply if nothing is changed.
9. **Go.** Members book from client-web (timetable, class, book, waitlist, my bookings, passes, inbox; #128). Staff
   see rosters and mark attendance from 30 minutes before the class; unmarked bookings count as attended (C-3).

## The operator's part

| When | What | How |
|---|---|---|
| A studio asks for more than the pilot allows | Raise one entitlement | `PUT /platform/organizations/{id}/billing/overrides/{key}` (operator console or API) |
| A studio moves off the free plan | Set its plan, record payments by hand | `platformSetPlan`, `platformRecordPayment` (manual provider until a payment provider exists, docs/28 B-1, B-2) |
| A studio must stop | Suspend / reactivate | `platformSuspendOrganization`, `platformReactivateOrganization` |
| The owner is gone | Force an owner transfer | `platformForceOwnerTransfer` |
| Watching | Dashboard and canary | CloudWatch `tempo-dev-dashboard` (#145); the canary emails on two failures of three |

## Still manual, and where it goes

| Item | Today | Later |
|---|---|---|
| Email to members (invitations, promotions, reminders) | the app's inbox only; invitation links are shared by hand | Phase 4 (docs/30, needs the domain and SES) |
| Selling passes to members | the desk grants passes | Phase 6 merchant payments |
| Moving a booking, a message to everyone booked, "add to calendar", freezing a membership | not yet | docs/29 section 16 (A1 to A5 of #136) |
| A second location | rooms only | Phase 6 |
| Backups | Neon's point-in-time restore inside the plan's window (6 hours on Free) | `docs/runbooks/restore.md` (B2) and the 10-studio tripwire (ADR-0021) for hourly backups |

## When something goes wrong during onboarding

- **402 on a write**: the studio is restricted (docs/28): over an entitlement or a suspended subscription. Check
  `GET /billing`; raise the override or set the plan.
- **403 on a write**: the role lacks the permission key (docs/27 section 8); `GET /permissions` lists them.
- **`invalid_scope` at sign-in**: `VITE_COGNITO_MFA_SETUP` is on but the app client does not allow the scope; turn
  the flag off or deploy #134.
- **A time zone the API does not know**: the daily job skips that studio and logs it; fix the studio's time zone.

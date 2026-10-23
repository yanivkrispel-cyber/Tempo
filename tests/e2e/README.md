# @tempo/e2e

End-to-end and accessibility tests for `apps/admin-web` and `apps/client-web`, with Playwright and
`@axe-core/playwright`. The suite drives the local Vite dev servers (admin-web on `:5173`, client-web on `:5174`)
pointed at the **dev** API and the dev Cognito user pool. It runs on a developer machine only, not in CI.

## Run it

```sh
pnpm install
pnpm --filter @tempo/e2e run e2e:install   # once: downloads Chromium
aws sso login --profile tempo              # so the suite can read the dev settings and the smoke user
pnpm e2e                                   # from the repo root
```

Other scripts in this workspace: `e2e:headed` (watch the browser), `e2e:report` (open the last HTML report),
`lint` (typecheck and ESLint).

Playwright starts both dev servers itself and stops them at the end. If one is already running on its port it is
reused, so make sure it points at the dev API.

## Configuration

Nothing secret is stored in the repo. Each value comes from an environment variable when set, otherwise from AWS
with the profile in `E2E_AWS_PROFILE` (default `tempo`, region `E2E_AWS_REGION`, default `eu-central-1`):

| Variable                                                            | Default source                                                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `E2E_API_URL`                                                       | CloudFormation output `HttpApiUrl` of `TempoDev-Api`                                                                       |
| `E2E_COGNITO_DOMAIN`, `E2E_ADMIN_CLIENT_ID`, `E2E_CLIENT_CLIENT_ID` | The user pool of `TempoDev-Identity` and its app clients                                                                   |
| `E2E_SMOKE_EMAIL`, `E2E_SMOKE_PASSWORD`                             | SSM `/tempo/dev/smoke-test/email` and `.../password` (see `docs/claude-memory/backend-patterns.md`, "Dev smoke-test user") |
| `E2E_STUDIO_SLUG`                                                   | `tempo-smoke-studio`                                                                                                       |
| `E2E_ENVIRONMENT`                                                   | `dev`                                                                                                                      |
| `E2E_ADMIN_URL`, `E2E_CLIENT_URL`                                   | The local Vite servers, `http://localhost:5173` and `http://localhost:5174`                                                |

If the settings or the smoke user cannot be resolved, the sign-in setup and every spec skip with a message.

## What it does

1. **Sign-in** (`specs/auth.setup.ts`): one real Hosted UI sign-in with the smoke user, into admin-web and then
   client-web. The browser state is saved to `.auth/smoke-user.json` and reused by every other spec. Tracing and
   screenshots are off for this step because the password is typed into the page.
2. **admin-web** (`specs/admin/`): the people list and search, the new-person dialog, the person card, the invite
   dialog (validation and the one-time link), and the members screen with the owner and the ownership handover.
3. **client-web** (`specs/client/`): the home screen greets the member by first name, on a phone viewport.
4. **SYNC 2 demo flow** (`specs/sync2/demo-flow.spec.ts`, project `sync2`, Pixel 7 for both apps): one serial file
   that walks issue #89 end to end. The owner creates a weekly class and a punch-card product in the console and
   grants the card on the person card; the member (the smoke user) books on client-web; a second, fictional e2e
   member fills a one-place class through the staff API and the smoke user joins its waitlist; staff cancel inside
   the free window on the console roster, the entry returns to the card and the smoke user is promoted, with the
   booking, the banner and the inbox notice on client-web; the roster and attendance (on a class that starts in
   twenty minutes, since marking opens thirty minutes before); the audit log; and the studio's `pilot` plan, read
   from `GET /billing` because the console has no screen that shows it yet. Rooms, class types, weekly classes,
   sessions, products and passes it creates are all `e2e-` and are removed afterwards. Both apps run on the Pixel 7:
   the console at the studio door is a phone too (#163).

5. **SYNC 6, reports and deleting a login** (`specs/sync6/`, project `sync6`, Pixel 7 for both apps): run it
   alone (`pnpm e2e --project=sync6`). It needs no smoke user. It creates two fresh Cognito users,
   `e2e-sync6-owner-…@example.com` and `e2e-sync6-member-…@example.com`, with random passwords that live only in
   memory.
   - The owner opens an `e2e-sync6` studio and adds a class a few minutes ahead. The member joins, books it and is
     marked attended.
   - The owner can't delete their login while they are the studio's only owner.
   - As staff, the member finds no reports, and the route and the API refuse them.
   - Once the class has started, the reports page shows the one visit and the fill rate.
   - The member deletes their login (A-1), and the person stays on the roster with no login.

   The run takes about eight minutes, most of it waiting for the class to start. Afterwards the owner's Cognito user is
   deleted and the studio stays for the operator's cleanup (A-4).

6. **Every screen on every device** (`specs/screens/`, project `screens`, D15 and #317): opens every route of both
   apps at six sizes, from a 360px phone through both tablet orientations to a 1920px desktop
   (`support/screens.ts`), signed in as the smoke user, and reads only. It fails when a page scrolls sideways, when
   a control on a touch screen is under 44px, or when axe finds something serious at 360 or 1280px, the two widths D15
   names. `console-menu.spec.ts` goes through the console's drawer and bottom bar on a phone by keyboard and by touch:
   closed, the drawer takes no focus; open, focus stays in it; closed again, focus is back on the button that opened
   it. Run it alone (`pnpm e2e --project=screens`, about twelve minutes);
   `E2E_SCREENSHOTS=1` also keeps a full-page picture of each screen and a `fit.jsonl` summary in
   `test-results/screens/`. To check the published dev sites instead of local servers, set
   `E2E_ADMIN_URL=https://tempo-studio-console.pages.dev` and `E2E_CLIENT_URL=https://tempo-members.pages.dev`.

7. **SYNC 7, member import, notes and tags** (`specs/sync7/`, project `sync7`, docs/34, board #321): run it alone
   (`pnpm e2e --project=sync7`, about three minutes). Like SYNC 6 it needs no smoke user: it creates
   `e2e-sync7-owner-…@example.com` and `e2e-sync7-staff-…@example.com` (`support/accounts.ts`). The owner works at
   1280px with a mouse, the staff member at 360px by touch (D15).
   - The owner opens an `e2e-sync7` studio, makes two tags, and imports a made-up six-row file with a batch tag. The
     check shows 3 to create, 1 already in the studio, 1 repeated and 1 invalid; the import creates the 3, tagged.
   - Staff add a note and a tag to an imported person, and the people list filters by that tag.
   - Staff see no import, and the route and the API refuse them; the API refuses them a new tag too.
   - The owner's export of that person carries the note (author by role) and both tags; after an erase both are gone.
   - axe runs on each new screen. The staff member deletes their own login (A-1). The owner's Cognito user is deleted
     at the end, and the studio stays for the operator's cleanup (A-4).

8. **SYNC 9, the live class, the "I'm in" card and the member home** (`specs/sync9/`, project `sync9`, board #481):
   run it alone (`pnpm e2e --project=sync9`). Like SYNC 8 it creates a fresh owner and two members
   (`e2e-sync9-…@example.com`) and an `e2e-sync9` studio with three reformers and a one-place class in 15 minutes.
   - Maya books reformer 1, and the booked sheet's "שיתוף לסטורי" saves the "I'm in" card (C-1).
   - Noa waits; the owner closes waiting an hour before the class, so Maya's late cancel frees reformer 1 and moves
     nobody. On OwnerLive (LV-1) the owner seats Noa with "שיבוץ למכשיר 1", her door code checks her in, and the map
     and the list show her arrival, at 1280px and 360px.
   - Noa's home shows the class under the week and the months under the weeks' dots; the owner's today shows the
     occupancy legend and the month's sales in whole shekels (LV-2).
   - The three Cognito users are deleted at the end; the studio stays for the operator's cleanup (A-4).

**axe on every screen.** `support/axe.ts` audits each screen against WCAG 2.2 A and AA. A serious or critical
violation fails the test; minor and moderate ones are attached to the report as annotations. The audit runs with the
pointer moved off the page, so it checks the resting screen and not a hover state.

**Selectors** are by role and Hebrew accessible name; `data-testid` only where a role cannot identify an element.

## Data

The suite touches only `tempo-smoke-studio`. Everything it creates has a name or address starting with `e2e-`, and
is removed in `afterAll` (people are erased, else archived; e2e invitations are revoked). The next run also clears
leftovers of an interrupted one. It never sends an ownership offer.

## Never commit

`.auth/` (access and refresh tokens), `test-results/` and `playwright-report/` (traces and screenshots) are
gitignored. Do not attach them to issues or PRs either.

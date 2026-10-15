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

If the settings or the smoke user cannot be resolved, the sign-in setup and every spec skip with a message.

## What it does

1. **Sign-in** (`specs/auth.setup.ts`): one real Hosted UI sign-in with the smoke user, into admin-web and then
   client-web. The browser state is saved to `.auth/smoke-user.json` and reused by every other spec. Tracing and
   screenshots are off for this step because the password is typed into the page.
2. **admin-web** (`specs/admin/`): the people list and search, the new-person dialog, the person card, the invite
   dialog (validation and the one-time link), and the members screen with the owner and the ownership handover.
3. **client-web** (`specs/client/`): the home screen greets the member by first name, on a phone viewport.

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

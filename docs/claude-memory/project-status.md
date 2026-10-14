# Project status

Updated 2026-10-15 (morning, after the night run on #44).

## Phase 0 (foundation) is closed, except the edge

- `feature/aws-foundation` merged into `main` on 2026-10-14 (PR #1); the design system package merged the same day
  (PR #22).
- Dev deploys from CI on every merge to `main` (`deploy-development.yml`): stacks, migrator and a smoke test that
  checks health, `/me` 401 and a worker round trip with an empty DLQ. First green run: 38570079474.
  Dev API: `https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com`.

## Phase 1: Identity, Organizations, Tenancy (backend merged 2026-10-15)

Design: `docs/26_Identity_Organization_Membership_LLD.md` with ADR-0023 (#30). Every step of its delivery plan is on
`main` and deployed to dev:

| Step | PR |
|---|---|
| LLD and ADR-0023 | #30 |
| OpenAPI contract (`contracts/openapi/tempo-api.v1.yaml`, contract-v1 = bff0122) | #31 |
| Operator user pool (MFA required) and both JWT schemes | #32 |
| Migration 0002: identity, organizations, audit, RLS | #33 |
| Building blocks: data sources, unit of work, tenant filter, Problem codes | #34 |
| Session, `GET /me`, `PATCH /me` | #35 |
| Studios and members | #36 |
| Invitations and the join link (migration 0003, join attempts) | #37 |
| Operator console and the studio audit log | #38 |
| The daily 10-studio tripwire (migration 0004) | #39 |
| End-to-end API flow test against PostgreSQL 18 | #40 |
| CORS for If-Match, Location, Retry-After; retry a failed data source build; tokens in the link fragment (D12) | #43 |
| Legacy platform-admin client removed from the customer pool | #52 |

Migrations on dev Neon: 0001 to 0004. The next migration number is 0005.

### What is left for Phase 1

| Item | Who |
|---|---|
| Register Kris as the first operator: create the user in `tempo-dev-operators`, then insert the row in `platform_admin.operators` by `sub` (steps in `backend-patterns.md`) | Kris, by hand |
| A dev test user, so the smoke test can call `POST /session` | Kris |
| Cognito sign-in in the apps (Hosted UI or SDK), then wiring the apps to `@tempo/api-client` | Ofir's machine |
| Invitation emails: wait for the domain and SES production access (docs/26 O-1) | Later |
| Open questions O-2 (join without approval) and O-3 (owner MFA): defaults apply until Kris says otherwise | Kris |

## Frontend (night of 2026-10-14)

- ADR-0024: Vite, React 19, React Router 7 (data mode), TanStack Query, `openapi-typescript` + `openapi-fetch`,
  Vitest (#49).
- `apps/client-web` (#48): routes `/`, `/book`, `/bookings`, `/profile` (member screens on sample data, #56), and
  `/invite`, `/join` reading the token from the fragment. React wrappers over the design system (#51), Dialog, toasts
  and dropdown menu (#54), date and time inputs (#55, two-digit years #57).
- `apps/admin-web` (#53): scaffold with `/invite`.
- `packages/api-client` (#50): generated from the contract; CI fails when it is stale.
- Until CloudFront is verified there is nowhere to host the apps in AWS; run them locally (ports 5173 admin, 5174
  client, matching the API's default app URLs).

## Phase 2: Authorization and People (design draft)

`docs/27_Authorization_and_People_LLD.md`, draft PR #47, waits for Kris's answers to its section 14 (eleven open
questions). Not merged.

## Open items

| Item | State |
|---|---|
| Dev edge (CloudFront) | Off in dev (`enableFrontendHosting`/`enableWaf` false) until AWS verifies the account. Support case 179198465900800, opened 2026-10-14. When AWS confirms, set both flags back to true and deploy. |
| Lambda concurrency | Account limit is still 40 (checked 2026-10-15); quota case 179192381800130 asks for 1000. |
| `COMMIT_SHA` | A local deploy reports `version=local`; CI sets the variable. |

Closed since the last update: the flaky Serilog test (#42) and the Aurora text in the infrastructure LLD (#41).

## Who works on what (agreed 2026-10-14)

Split by area, not by task, so the two machines rarely touch the same files. The meeting point is the API contract
in `contracts/openapi/`.

| Area | Owner |
|---|---|
| `backend/`, `tests/`, `infrastructure/`, database migrations, `docs/` (ADR, LLD), writing `contracts/openapi/` | Kris's machine (Kris + Claude) |
| `apps/`, `packages/` (design system, API client), the Frontend CI job | Ofir's machine (Ofir + Claude) |

- Database migrations: only Kris's machine writes them. Ofir asks for a schema change instead.
- Shared files that can conflict: `pnpm-lock.yaml` and the root `package.json` (on conflict, regenerate with
  `pnpm install` on top of `main`, never hand-merge), `.github/workflows/`, `CLAUDE.md` and this folder.
- Each side reviews the other's PRs; approval must be on the head commit.
- Merges are squash, except the Phase 1 chain #32 to #40 and #43, which merged with merge commits (one-time
  exception, night of 2026-10-14).

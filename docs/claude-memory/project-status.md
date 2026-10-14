# Project status

Updated 2026-10-14 (evening).

## Phase 0 (foundation) is closed, except the edge

- `feature/aws-foundation` merged into `main` on 2026-10-14 (PR #1); the design system package merged the same day
  (PR #22).
- Dev deploys from CI on every merge to `main` (`deploy-development.yml`): stacks, migrator and a smoke test that
  checks health, `/me` 401 and a worker round trip with an empty DLQ. First green run: 38570079474.
  Dev API: `https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com`.

## Open items

| Item | State |
|---|---|
| Dev edge (CloudFront) | Off in dev (`enableFrontendHosting`/`enableWaf` false) until AWS verifies the account. Support case 179198465900800, opened 2026-10-14. When AWS confirms, set both flags back to true and deploy. |
| Lambda concurrency | Account limit is 40; quota case 179192381800130 asks for 1000. |
| Flaky test | `MeEndpointTests.Me_WithRejectedToken_Returns401` sometimes fails with "The logger is already frozen" (Serilog bootstrap logger, parallel hosts). A rerun passes. Ofir's first PR. |
| `COMMIT_SHA` | A local deploy reports `version=local`; CI sets the variable. |
| Docs | LLD sections 10 and 11 still describe Aurora; ADR-0022 (Neon) is the source of truth. |

## Phase 1: Identity, Organizations, Tenancy (started 2026-10-14)

D7 and D8 were decided on 2026-10-14 (see `decisions.md`). The design is
`docs/26_Identity_Organization_Membership_LLD.md` with ADR-0023. Code follows that document, one PR per step.

## Who works on what (agreed 2026-10-14)

Split by area, not by task, so the two machines rarely touch the same files. The meeting point is the API contract
in `contracts/openapi/`.

| Area | Owner |
|---|---|
| `backend/`, `tests/`, `infrastructure/`, database migrations, `docs/` (ADR, LLD), writing `contracts/openapi/` | Kris's machine (Kris + Claude) |
| `apps/`, `packages/design-system`, the Frontend CI job, the generated API client | Ofir's machine (Ofir + Claude) |

- Database migrations: only Kris's machine writes them during Phase 1. Ofir asks for a schema change instead.
- Shared files that can conflict: `pnpm-lock.yaml` and the root `package.json` (on conflict, rebase and rerun
  `pnpm install`, never hand-merge), `.github/workflows/`, `CLAUDE.md` and this folder. Announce changes to them in the
  draft PR title.
- Each side reviews the other's PRs.

### Ofir's queue, in order

1. Onboarding per `CONTRIBUTING.md`; Neon access is in place (Editor on the project, through the org). Create the
   Neon branch `dev-ofir` from `production`.
2. First PR: fix the flaky Serilog test above (a deliberate exception to the area split; Kris's machine stays off
   that file until it merges).
3. A short ADR proposal for the frontend toolchain (React is decided; build tool, router, data-fetching library).
   $0 cost. Kris approves.
4. Scaffold `apps/client-web` (the member PWA): RTL, Hebrew, `@tempo/design-system`, built in CI.
5. React wrappers over the `tp-*` classes, plus the missing primitives: date/time picker, dropdown menu, charts.
6. The member screens from the mockup (home, book a class, my bookings, profile) on sample data, no backend.
7. A generated API client and Cognito sign-in, once the Phase 1 contract is in `contracts/openapi/`.
8. Scaffold `apps/admin-web` (the studio owner's console).

Until CloudFront is verified there is nowhere to host the PWA in AWS; run it locally.

### Kris's machine queue, in order

1. Phase 1 LLD and ADR-0023 (docs PR).
2. The Phase 1 OpenAPI contract, early, so Ofir can build against it.
3. Infra: the operator user pool and API configuration.
4. Migration 0002: identity, organizations, audit, with RLS, plus isolation tests.
5. API building blocks, then accounts, organizations and memberships, invitations and join links, audit and platform
   endpoints.
6. Docs cleanup: LLD sections that still describe Aurora.
7. When AWS verifies CloudFront: re-enable the dev edge.

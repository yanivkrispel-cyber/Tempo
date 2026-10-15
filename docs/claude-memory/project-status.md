# Project status

Updated 2026-10-15, evening (day board #60, evening board #89).

## In one paragraph

Phases 0, 1 and 2 of `docs/24` are on `main` and live on dev, and so is the backend of the first vertical
skeleton, Studio scheduling (docs/29). The next backend work is thin Phase 3 billing (docs/28) and the apps'
scheduling screens. The repo is **public** since 2026-10-15: no secrets, tokens, real people's emails or personal
data in code, PRs, issues or logs.

## Phase 0 (foundation): closed, except the edge

- Dev deploys from CI on every merge to `main` (`deploy-development.yml`): stacks, migrator and a smoke test.
  Dev API: `https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com`.
- Dev edge (CloudFront) stays off until AWS verifies the account (support case 179198465900800). Lambda
  concurrency is still 40 (quota case 179192381800130).

## Phase 1 (identity, studios, tenancy): done

docs/26 and ADR-0023, PRs #30 to #43 and #52. Migrations 0002 to 0004.

## Phase 2 (authorization and people): done (2026-10-15)

docs/27 with every section 14 default decided by Kris (#47). Permissions on every tenant route, the roles API with
step-up, owner transfer (tenant and operator), people, contact points, consent, relationships, duplicates and
merge, export and erase, inviting a recorded person (#61 to #88). Migrations 0005 to 0008. Privacy fix #90: the
audit log keeps no invitee email, and erasing a person revokes and scrubs their invitations.

## Studio skeleton: scheduling and passes (backend done 2026-10-15)

Kris decided on 2026-10-15 (board #89): scheduling runs in parallel with thin billing; booking needs a punch
card or a membership already in the skeleton (granted by hand at the desk); the waitlist promotes automatically.

| Step | PR |
|---|---|
| LLD `docs/29_Studio_Scheduling_and_Passes_LLD.md` (open questions C-1 to C-8 have defaults) | #91 |
| contract-v3 (37 operations, `x-tempo-planned` until built; the conformance test checks both ways) | #92 |
| Migration 0010: `scheduling` and `notifications` schemas, RLS, six permission keys | #93 |
| Timetable, passes, booking, waitlist with promotion, roster, attendance, booking policy, inbox | #95 |
| Daily job: eight-week horizon, closed waitlists (second Scheduler schedule, $0) | #100 |

- Concurrency is in the schema: `booked_count <= capacity` and `entries_used <= entries` are CHECKs, and the
  services take places and entries with guarded updates. Tests: 20 parallel bookings for 8 places give 8 booked and
  12 waiting; parallel bookings on a card's last entry spend it once.
- `StudioScheduleFlowTests` runs the demo of docs/29 section 1 through the real host.
- Migration 0009 is reserved for billing (docs/28); DbUp applies scripts by name, so the gap is harmless.

## Phase 3 (billing and entitlements): designed

`docs/28_Billing_and_Entitlements_LLD.md` (#83), section 14 defaults apply. Thin first: a free `pilot` plan with an
**active** subscription per studio (a trial would restrict every pilot studio after 30 days under the manual
provider), entitlements, restricted mode. No payment provider until a studio is ready to pay (B-1, B-2, B-6 go
back to Kris then).

## Apps

`apps/client-web` and `apps/admin-web` run on the real API for Phases 1 and 2 (sign-in with the Hosted UI,
studios, members, invitations, roles, people, consent, owner transfer, duplicates, export, erase). Their
scheduling screens still use sample data; contract-v3 types are in `@tempo/api-client` since #92.

## Open items for Kris

| Item | Note |
|---|---|
| Register as the first operator | `tools/scripts/register-operator.ps1`, needs Kris's MFA |
| IAM grants so CI can run the smoke test with `--sign-in` | `cognito-idp:AdminInitiateAuth` and `ssm:GetParameter` for the deploy role |
| Consent texts (P-4) and the accountant/lawyer check (P-2) | Before the pilot |
| Owner MFA switch (`TEMPO_REQUIRE_OWNER_MFA`) | Needs the TOTP enrollment screen first (O8) |
| Docs/29 open questions C-1 to C-8 | Defaults apply unless Kris objects |

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

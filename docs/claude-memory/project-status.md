# Project status

Updated 2026-10-14.

## Phase 0 (foundation) is almost closed

- `feature/aws-foundation` merged into `main` on 2026-10-14 (PR #1). Before that, PRs #2 to #20 landed in small steps.
- First dev deploy ran on 2026-10-14 from a laptop: 8 of 9 stacks are up. The migrator ran and the smoke test passed
  (health 200, `/me` 401 without a token, the worker drained the queue).
  Dev API: `https://2a5q3fao7a.execute-api.eu-central-1.amazonaws.com`.
- From now on dev deploys from CI on every merge to `main`.

## Open items

| Item | State |
|---|---|
| `TempoDev-Edge` (us-east-1) | Fails: "Your account must be verified before you can add new CloudFront resources". Needs an AWS support case by the owner. The stack sits empty in ROLLBACK_COMPLETE; CDK replaces it on the next deploy. Until then the CI deploy job may end red on this stack. |
| Lambda concurrency | Account limit is 40; quota case 179192381800130 asks for 1000. |
| Flaky test | `MeEndpointTests.Me_WithRejectedToken_Returns401` sometimes fails with "The logger is already frozen" (Serilog bootstrap logger, parallel hosts). A rerun passes. Fix pending. |
| `COMMIT_SHA` | A local deploy reports `version=local`; CI sets the variable. |
| Design system | `packages/design-system` is on branch `feature/design-system`, not merged yet. |
| Docs | LLD sections still describe Aurora in places; ADR-0022 (Neon) is the source of truth. |

## Next, in order

1. Merge the design system PR.
2. Fix the flaky Serilog test.
3. LLD sections for Neon (ADR-0005, 0006, 0019, 0021 follow-ups).
4. Phase 1: the Identity / Organization / Membership LLD. Open decisions first: D7 (studio onboarding flow) and D8
   (admin MFA).

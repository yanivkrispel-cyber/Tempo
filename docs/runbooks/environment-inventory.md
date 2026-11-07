# Runbook: what an environment needs that the code does not hold

Written on 2026-11-07 (board #627, for #543). This is the "written list of every human-held value" that
`docs/runbooks/production-readiness.md` section 3c asks for. It holds names and places, never values. The rebuild order
below comes from reading the code and has **never been rehearsed**: the acceptance in section 3c, one rebuild of a
throwaway stage inside the 4-hour RTO, is still open.

## Values a person holds

All SSM paths are under `/tempo/<env>/`, in `eu-central-1`. A person writes them; Claude prepares the command at most.

| Value | Kept in | Made by | If it is lost |
|---|---|---|---|
| `db/neon-connection-string` | SSM | Copied from Neon | Read it again from Neon |
| `db/app-password` | SSM | Generated; 32 or more letters and digits | Rotate it; the migrator fails if it is missing |
| `db/platform-password` | SSM | As above | As above |
| `db/migrator-password` | SSM | As above | As above |
| `neon/api-key` | SSM | Neon console | Make a new one |
| `health/data-key/<version>` | SSM, one version each | `tools/scripts/health-data-key.mjs` | **Every health answer under that version is unreadable and members sign again.** Offline copy: #308, open |
| `push/vapid-public-key`, `push/vapid-private-key` | SSM | `tools/scripts/vapid-keys.mjs` | A new pair: existing push subscriptions stop working until members turn notifications on again (to verify) |
| `smoke-test` (`email`, `password`) | SSM | By hand, with the Cognito user | Make the user again |
| `support/contact` | SSM | By hand (`docs/runbooks/kris-pilot-steps.md`) | The contact hides until it is set |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | GitHub Actions secrets | Cloudflare dashboard | Make a new token |

State the system writes itself, not to be restored: `neon/usage-warning`, `canary/<check>`.

## Values outside any parameter

| What | Where | Note |
|---|---|---|
| AWS accounts and Identity Center users | AWS Organizations | Each person signs in as themselves |
| The Neon project and its branches | Neon, one owner account | `docs/claude-memory/database-neon.md` |
| Operators | Cognito `tempo-<env>-operators` and `platform_admin.operators` | `tools/scripts/register-operator.ps1`, run by a person, with MFA |
| Domain and certificates | Not bought yet | Production item, `production-readiness.md` section 0 |

## Rebuilding, in order

1. **Account.** Sign in, then `cdk bootstrap` for the account and `eu-central-1`.
2. **Neon.** A project in the same region, or a restore (`docs/runbooks/restore.md`).
3. **SSM.** Every value above that exists before the first deploy. The three role passwords must be there before the
   migrator runs. Never make a new `health/data-key` version for a restored database: write back the old key.
4. **Deploy.** `cdk deploy` of the stage in `infrastructure/lib/tempo-stage.ts`: account baseline, GitHub OIDC, security,
   identity, database, messaging, API, edge, canary (dev only), observability. Normally through the workflow; the first
   time the OIDC role does not exist, so a person runs it.
5. **Migrate.** Invoke `tempo-<env>-database-migrator`, as the deploy workflow does.
6. **Web.** The GitHub secrets, then the apps to Cloudflare Pages (ADR-0027).
7. **People.** Register the operators and the smoke-test user.
8. **Prove it.** `node tools/scripts/smoke-test.mjs` against the new API, then the restore drill's row counts.

## What a rebuild cannot bring back

- **Cognito users.** Passwords can't be exported, and a new pool gives every user a new `sub`. Accounts are matched by
  `identity.external_identities (issuer, subject)`, so a restored database does not find its users in a new pool until
  they are linked again. **No procedure or script for this exists.** The pools have deletion protection where
  `enableDeletionProtection` is on and are retained on prod, so the pool is the thing to protect.
- **Passkeys.** Bound to the relying party's host (`identity-stack.ts`); a new host means enrolling again.
- **Media.** The bucket has no versioning (`production-readiness.md` section 3a).

## Related

- `docs/runbooks/production-readiness.md` sections 0 and 3, `docs/runbooks/restore.md`, `docs/runbooks/dlq-replay.md`
- ADR-0019, ADR-0026, ADR-0027, `docs/claude-memory/aws-and-deploy.md`

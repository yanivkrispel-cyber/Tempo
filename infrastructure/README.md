# Tempo AWS Infrastructure

AWS CDK (TypeScript) implementation of the Tempo Phase 0 AWS foundation, per
[`docs/01_AWS_Infrastructure_LLD.md`](../docs/01_AWS_Infrastructure_LLD.md)
and the accepted ADRs under [`docs/ADR/`](../docs/ADR/).

## What this deploys

Per environment (`dev`, `stg`, `prod` - only `dev` is meant to actually be
deployed by this change set):

| Stack | Contents |
|---|---|
| `AccountBaseline` | AWS Budgets, Cost Anomaly Detection |
| `GitHubOidc` | GitHub Actions OIDC provider + per-environment deployment role |
| `Network` | VPC (2 AZs, private isolated subnets only, no NAT), Lambda/Aurora security groups, Secrets Manager interface endpoint |
| `Security` | IAM Access Analyzer (account) |
| `Identity` | Cognito User Pool + 3 browser app clients (admin-web, client-web, platform-admin-web) |
| `Database` | Aurora PostgreSQL Serverless v2, Secrets Manager credentials, Tempo.DatabaseMigrator Lambda |
| `Events` | Custom EventBridge bus |
| `Messaging` | SQS queues + DLQs, Tempo.Worker Lambda, smoke-test EventBridge rule |
| `Scheduler` | EventBridge Scheduler foundation (disabled by default) |
| `Api` | API Gateway HTTP API, Tempo.Api Lambda, Cognito JWT authorizer |
| `Observability` | CloudWatch alarms + dashboard |

**Not included in this phase** (see the completion report for why): S3/CloudFront/Route 53/ACM/WAF (`StorageStack`/`FrontendStack`) - no root domain was provided and frontend hosting is explicitly deferrable per the Phase 0 scope.

## Commands

Run from the repository root unless noted:

```bash
pnpm install                                  # installs the whole workspace, including infrastructure
pnpm --filter @tempo/infrastructure test      # CDK unit tests (vitest + aws-cdk-lib/assertions)
pnpm --filter @tempo/infrastructure run build # tsc --noEmit type-check
```

Or from `infrastructure/` directly:

```bash
pnpm test          # CDK unit tests
pnpm run build     # type-check
npx cdk synth       # synthesizes TempoDev, TempoStg and TempoProd
npx cdk diff 'TempoDev/*'   # requires AWS credentials for the dev account
npx cdk deploy 'TempoDev/*' --require-approval never
```

`cdk synth` always synthesizes all three environments' stacks in one run
(`TempoDev/*`, `TempoStg/*`, `TempoProd/*`); `cdk deploy`/`cdk diff` still
require you to name the stage explicitly, so staging/production can never be
deployed by accident.

## Environment configuration

Typed configuration lives in `config/environment-config.ts` (the shared
interface + `validateEnvironmentConfig`, which fails `cdk synth` on invalid
or unsafely-defaulted values) and `config/{development,staging,production}.ts`
(the per-environment values). Secrets are never stored here - only ARNs,
account IDs and non-secret settings.

`development.ts` holds the real values provided for this phase (AWS account
`687239340846`, region `eu-central-1`, GitHub repo
`yanivkrispel-cyber/Tempo`). `staging.ts` and `production.ts` use placeholder
account IDs (`000000000000`) and placeholder domains (`*.tempo.example`) -
they exist so `cdk synth` can validate their safety invariants (deletion
protection, no auto-pause, non-zero minimum ACU, alarm notifications,
protected GitHub environment) without inventing real staging/production
infrastructure ahead of need. Replace the placeholders before those
environments are actually deployed.

## Lambda deployment packages

`lib/constructs/dotnet-lambda-code.ts` looks for each Lambda project's
publish output at:

```text
backend/<ProjectName>/bin/Release/net10.0/linux-arm64/publish
```

`deploy-development.yml` runs `dotnet publish --configuration Release
--runtime linux-arm64 --self-contained false` for `Tempo.Api`, `Tempo.Worker`
and `Tempo.DatabaseMigrator` before `cdk deploy`. If that folder does not
exist (e.g. running `cdk synth`/CDK tests on a machine without the .NET SDK
installed), a placeholder asset is used instead so infrastructure can still
be synthesized and reviewed - see
`lib/constructs/placeholder-lambda/NOT_A_REAL_PACKAGE.txt`. **A deployment
that resolves to the placeholder does not run real application code** -
always run the `dotnet publish` step (or `dotnet build`+publish locally)
before `cdk deploy`.

## GitHub OIDC setup (one-time, manual)

1. Confirm no OIDC provider for `token.actions.githubusercontent.com`
   already exists in the target AWS account
   (`aws iam list-open-id-connect-providers`). AWS allows only one
   provider per issuer URL per account - if one already exists (from
   another project), replace the `new OpenIdConnectProvider(...)` call in
   `lib/foundations/github-oidc-stack.ts` with
   `OpenIdConnectProvider.fromOpenIdConnectProviderArn(...)`.
2. Bootstrap the CDK toolkit in the target account/region (one-time, needs
   an administrator, not GitHub Actions):
   ```bash
   npx cdk bootstrap aws://687239340846/eu-central-1
   ```
3. Deploy `TempoDev/GitHubOidc` once with administrator credentials so the
   deployment role exists before CI first tries to assume it:
   ```bash
   npx cdk deploy TempoDev-GitHubOidc
   ```
4. No GitHub repository secrets are needed - `deploy-development.yml`
   assumes `arn:aws:iam::687239340846:role/tempo-dev-github-deploy` via
   OIDC. The trust policy restricts assumption to
   `repo:yanivkrispel-cyber/Tempo:ref:refs/heads/main` only.

## Cost-sensitive decisions

- No NAT Gateway (`networking.natGatewayEnabled` is validated to always be
  `false`; ADR-0017 remains Proposed pending its cost/failure-mode spike).
- Aurora Serverless v2: `minAcu: 0`, `maxAcu: 2`, auto-pause after 5 minutes
  idle in dev.
- Only one VPC interface endpoint (Secrets Manager) - added because
  Tempo.DatabaseMigrator runs in the private isolated subnets with no NAT
  and must reach Secrets Manager; no other endpoints are pre-provisioned.
- The API Lambda and Worker Lambda are **not** VPC-attached in this phase
  (no Aurora I/O yet), avoiding VPC cold starts and further endpoint cost
  until a real database-connected workload exists.
- CloudWatch log retention is explicit everywhere (14 days in dev).
- IAM Access Analyzer instead of a Config-rule-based baseline (free vs.
  per-configuration-item billing).

## Known limitations / remaining work

- Frontend hosting (S3/CloudFront/Route 53/ACM/WAF) is not implemented -
  no root domain was provided.
- Mandatory MFA specifically for `platform-admin-web` is not enforced
  per-app-client - Cognito MFA is pool-wide (`OPTIONAL`/TOTP). Enforcing
  "MFA required for platform admins only" needs a pre-token-generation
  Lambda trigger or a separate user pool; deferred to the
  Identity/Membership LLD phase.
- The outbox worker and Tempo.DatabaseMigrator's bootstrap step are real,
  but there is no domain schema yet - by design (LLD section 11: "the goal
  in this phase is the migration mechanism, not the full domain schema").
- `staging.ts`/`production.ts` use placeholder AWS account IDs and domains.
- ADR-0017 (Lambda networking / NAT cost control) is still **Proposed**;
  this implementation follows its guardrails for development but the
  production NAT-vs-split-worker decision remains open pending that ADR's
  spike.

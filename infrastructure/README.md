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
| `Security` | IAM Access Analyzer (account) |
| `Identity` | Cognito User Pool + 3 browser app clients (admin-web, client-web, platform-admin-web) |
| `Database` | Tempo.DatabaseMigrator Lambda, outside any VPC, reading the Neon credentials from SSM (ADR-0022). The database itself is a Neon project, not a CloudFormation resource |
| `Messaging` | One SQS work queue + DLQ, Tempo.Worker Lambda routing by `MessageType` (ADR-0008 amendment) |
| `Api` | API Gateway HTTP API, Tempo.Api Lambda, Cognito JWT authorizer |
| `Observability` | CloudWatch alarms (production only) + the `tempo-<env>-dashboard` page: API, Lambda against the concurrency quota, work queue, daily jobs and canary, Scheduler, Neon |

**Not included in this phase** (see the completion report for why): S3/CloudFront/Route 53/ACM/WAF (`StorageStack`/`FrontendStack`) - no root domain was provided and frontend hosting is explicitly deferrable per the Phase 0 scope.

## Local AWS credentials (SSO)

`cdk diff`/`cdk deploy` need AWS credentials for the dev account `687239340846`
(`eu-central-1`). Since 2026-10-13 dev runs in the Organization's management
account: the member account `tempo-dev` (254631022581) never finished AWS
activation, so the user moved dev back (status page decision D1, revised).
Only Tempo stacks live there; nothing touches Organizations, IAM Identity
Center or Billing. Configure an SSO profile once:

```bash
aws configure sso --profile tempo-mgmt
# SSO start URL: https://d-99674d7b12.awsapps.com/start
# SSO region:    eu-central-1
# (browser login, then pick the 687239340846 / AdministratorAccess account+role)
# Default client Region: eu-central-1
```

Set it as your default profile so you don't need `--profile` on every
command:

```bash
# bash/zsh (~/.bashrc, ~/.zshrc)
export AWS_PROFILE=tempo-mgmt

# PowerShell ($PROFILE)
$env:AWS_PROFILE = "tempo-mgmt"
```

SSO sessions expire (per org policy); re-run `aws sso login --profile
tempo-mgmt` (or `aws configure sso --profile tempo-mgmt` again) once
`aws sts get-caller-identity` starts failing with an expired-token error.

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

`development.ts` holds the real values for this phase (AWS account
`687239340846`, region `eu-central-1`, GitHub repo
`yanivkrispel-cyber/Tempo`). `staging.ts` and `production.ts` use placeholder
account IDs (`000000000000`) and placeholder domains (`*.tempo.example`) -
they exist so `cdk synth` can validate their safety invariants (deletion
protection, alarm notifications, protected GitHub environment) without inventing real staging/production
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
   npx cdk bootstrap aws://687239340846/eu-central-1 --bootstrap-kms-key-id AWS_MANAGED_KEY
   ```
3. Deploy `TempoDev/GitHubOidc` once with administrator credentials so the
   deployment role exists before CI first tries to assume it. Stacks inside a
   Stage are selected by path; `TempoDev-GitHubOidc` matches no stack:
   ```bash
   npx cdk deploy 'TempoDev/GitHubOidc'
   ```
4. No GitHub repository secrets are needed - `deploy-development.yml`
   assumes `arn:aws:iam::687239340846:role/tempo-dev-github-deploy` via
   OIDC. The trust policy restricts assumption to
   `repo:yanivkrispel-cyber/Tempo:ref:refs/heads/main` only.

## Database credentials (one-time per environment, manual)

The database is a Neon project per environment (ADR-0022). The migrator
reads four SSM SecureString parameters, which CloudFormation cannot create
and which never pass through CDK, so a person writes them:

| Parameter | Value |
|---|---|
| `/tempo/<env>/db/neon-connection-string` | The Neon owner role's `postgresql://` URL on the **direct** endpoint (no `-pooler`) |
| `/tempo/<env>/db/app-password` | Password of `tempo_app`, letters and digits only |
| `/tempo/<env>/db/platform-password` | Password of `tempo_platform`, the operator console's role (ADR-0023), letters and digits only |
| `/tempo/<env>/db/migrator-password` | Password of `tempo_migrator`, letters and digits only |

The migrator sets all three role passwords from these values on every run, so
changing a parameter and redeploying rotates it. In PowerShell, for dev:

```powershell
foreach ($name in 'app-password', 'platform-password', 'migrator-password') {
  $bytes = [byte[]]::new(24)
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $value = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  aws ssm put-parameter --name "/tempo/dev/db/$name" --type SecureString --value $value --overwrite --profile tempo-mgmt --region eu-central-1
}
```

### Neon API key (for the usage check)

`tempo-<env>-neon-usage` runs every six hours, reads the project's usage in
the current period from the Neon API and publishes the highest share of a
Free plan limit as `Tempo/Database NeonFreeLimitPercent`. Production alarms
at 70% (`tempo-prod-neon-free-limit`). It needs a Neon API key that can
read the project, in `/tempo/<env>/neon/api-key`. Without it the function
fails, which shows in the Lambda errors alarm. To store it without echoing
it:

```powershell
$key = Read-Host -AsSecureString "Neon API key"
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($key))
aws ssm put-parameter --name "/tempo/dev/neon/api-key" --type SecureString --value $plain --overwrite --profile tempo-mgmt --region eu-central-1
```

## Cost-sensitive decisions

- No VPC, NAT gateway, interface endpoint or Secrets Manager secret
  (ADR-0022, ADR-0021). The fixed-cost guard test's allowlist is empty.
- The database is Neon on the Free plan: $0, with limits per project
  (100 CU-hours a month, 1 GB, 5 GB egress). Over a limit, Neon suspends
  the compute, so production moves to the Launch plan before the pilot.
- Database credentials are free standard SSM SecureString parameters on the
  AWS managed `aws/ssm` key.
- The Neon usage check costs $0: four Lambda runs a day, four Scheduler
  invocations, and one custom metric (ten are free per account).
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
- The Neon usage check reads only the current billing period. Neon resets
  usage on the first of the month, so the metric drops then.

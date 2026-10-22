# Backend patterns (Phase 1)

How the API is put together since the Phase 1 building blocks (docs/26 sections 2.2, 6, 7.4 and 8.5).

## Routes

- Never map an authenticated endpoint directly. Use one of the groups in `backend/Tempo.Api/Tenancy/RouteGroups.cs`:
  - `MapAccountGroup()`: `/api/v1/...`, customer token, no tenant (session, me, creating a studio, joining).
  - `MapTenantGroup()`: `/api/v1/organizations/{organizationId:guid}/...`, customer token, plus `TenantRouteFilter`.
    Read the tenant with `TenantRouteFilter.Current(httpContext)`.
  - `MapPlatformGroup()`: `/api/v1/platform/...`, operator token only.
- A tenant route that must still answer for a suspended studio carries `AllowWhenOrganizationSuspendedAttribute`
  as metadata.
- A module adds its endpoints by registering an `IEndpointModule` in DI; `Program.cs` maps all of them.

## Accounts (step 6)

- `POST /api/v1/session` provisions just in time (`Modules/Identity/Application/AccountService.cs`): look up
  `(iss, sub)`; on a miss read email from Cognito `AdminGetUser` (the token's `username` claim, the pool id from the
  issuer) and insert account, external identity and an `account.created` audit event in one transaction. A
  unique-key race re-reads the winner's row. A sign-in whose `auth_time` is newer than `identity_synced_at` refreshes
  email and verification.
- `GET /api/v1/me` is the only route a disabled account may call. `PATCH /api/v1/me` goes through `CallerAccount`.
- Audit events are written with `AuditWriter` inside the caller's unit of work.
- API Gateway has one `ANY /api/v1/{proxy+}` route without a gateway authorizer; the API checks tokens itself. The old
  `GET /api/v1/me` route with the JWT authorizer still exists and wins for that path.
- The API reaches Neon's pooled endpoint from `neon.pooledHost` and `neon.databaseName` in the environment config.
  Dev: `ep-bold-art-b94ii1t4-pooler.c-7.eu-central-1.aws.neon.tech`, database `neondb`.

## Invitations and join link (step 8)

- Tokens (32 bytes) and join codes (16 bytes) are base64url from `SecretToken.New`; only the SHA-256 hash is stored.
  They are found before any tenant is known through the two `SECURITY DEFINER` functions, then the unit of work moves
  to that studio with `SetTenantAsync`.
- Links: `ADMIN_APP_URL` / `CLIENT_APP_URL` (`AppLinks`), shaped `<app>/invite#<token>` and `<client app>/join#<code>`:
  the value is in the fragment so no server log ever sees it (Kris, 2026-10-15). Client invitations and join links go to the client app,
  staff and admin invitations to the admin app. CDK takes both origins from the first Cognito callback URL of each app.
- Preview and accept calls pass `IAttemptLimiter` first: 20 per account per hour in `identity.join_attempts`
  (migration 0003), committed before the work so failed guesses count. Over the limit is 429 with `Retry-After`.
- Accepting or joining twice returns the existing membership; a suspended membership or studio is 403.

## Operator console (step 9)

- `/api/v1/platform/*` runs as `tempo_platform` (`Modules/PlatformAdmin/PlatformService.cs`). `OperatorRouteFilter`
  needs an active row in `platform_admin.operators` matching the token's issuer and `sub`, otherwise 403
  `operator.not_registered`. Every call on one studio is audited with `actor_type = 'operator'`, reads included.
- The API never reads operator emails from Cognito (its `AdminGetUser` right covers the customer pool only), so a
  person registers an operator with the `sub` already filled in. One command does steps 1 and 2 and prints the SQL:
  `.\tools\scripts\register-operator.ps1 -Email <email>` (PowerShell, `--profile tempo`). By hand:

  ```powershell
  $pool = aws cognito-idp list-user-pools --max-results 20 --profile tempo --region eu-central-1 --query "UserPools[?Name=='tempo-dev-operators'].Id" --output text
  aws cognito-idp admin-create-user --user-pool-id $pool --username <email> --user-attributes Name=email,Value=<email> Name=email_verified,Value=true --profile tempo --region eu-central-1
  aws cognito-idp admin-get-user --user-pool-id $pool --username <email> --profile tempo --region eu-central-1 --query "UserAttributes[?Name=='sub'].Value" --output text
  ```

  Then, in the Neon SQL editor as the owner (a person, not Claude):

  ```sql
  INSERT INTO platform_admin.operators (id, email, issuer, subject, status, created_at, updated_at)
  VALUES (uuidv7(), '<email>', 'https://cognito-idp.eu-central-1.amazonaws.com/<pool id>', '<sub>', 'active', now(), now());
  ```

  The first sign-in sets a TOTP device, because the pool requires MFA.
- A studio's own audit log: `GET /organizations/{id}/audit-events`, owner and admin, names for user actors only.

## The 10-studio tripwire (step 9, part 2)

- Daily at 06:00 Israel time, EventBridge Scheduler's universal target `aws-sdk:sqs:sendMessage` puts a
  `tripwire.check` message on the work queue (the templated SQS target cannot set `MessageType`).
- The worker (`Consumers/Tripwire`) runs `HourlyBackupTripwire` as `tempo_platform`: at 10 active studios it records
  a row in `platform_admin.tripwires` (migration 0004) and, where `ALARM_TOPIC_ARN` is set (staging and production),
  publishes once to `tempo-<env>-alarms`. The row commits only after the publish, so a failed send retries next day.
- `ConfiguredDataSourceProvider` lives in `Tempo.Platform` now; the API passes `IConfiguration`, the worker
  environment variables.
- `AWSSDK.SimpleNotificationService` is pinned to 4.0.100.12: Smart App Control here blocks the analyzer DLL in
  4.0.100.14, and `ExcludeAssets="analyzers"` does not stop the AWS SDK's analyzer from loading.

## Tokens

- Two JWT bearer schemes, `customer` (the default policy) and `operator` (policy `operator`), in
  `DependencyInjection/CognitoAuthentication.cs`. Each is configured as a named `CognitoOptions` and a named
  `JwtBearerOptions`; tests post-configure them by scheme name.
- A 401 is Problem Details with `code: auth.unauthorized`.

## Errors

- Throw `DomainRuleViolationException(kind, code, title)` from domain or application code. `DomainRuleViolationHandler`
  maps the kind to the status and writes Problem Details with `code` and `correlationId`.
- Endpoints that answer a problem directly use `Problems.Result(httpContext, status, code, title)`.

## Database

- Plain Npgsql. `UnitOfWork.BeginAsync(dataSources, role, userAccountId, organizationId, ct)` opens one transaction
  and sets the RLS values with `is_local = true`. Disposing without `CommitAsync` rolls back. `SetTenantAsync` moves
  the transaction to a tenant learned part-way (creating a studio, accepting an invitation, joining).
- Positional parameters (`$1`, `$2`) allow one statement per command.
- `ConfiguredDataSourceProvider` builds the data sources on first use. Locally: `DATABASE_APP_CONNECTION_STRING` and
  `DATABASE_PLATFORM_CONNECTION_STRING`. Deployed: `DATABASE_HOST`, `DATABASE_NAME` and the two password parameter
  names, with the passwords read from SSM once per cold start.

## Cold start (board #445, P-1)

- `Tempo.Api` builds its minimal API endpoints with the Request Delegate Generator (`EnableRequestDelegateGenerator`):
  no reflection or compiled expressions on the first request. A new endpoint pattern the generator can't handle
  shows as a build warning (an error here); fix the endpoint rather than turning the generator off.
- On Lambda, `ColdStartWarmUp` builds every endpoint in Init and starts the JWKS fetch and the app role's SSM read
  there. It never opens a database connection (a canary `/health` cold start must not wake Neon).
- `ColdStart.Current` (Tempo.Platform) times a new environment until its first request ends: one log line
  `cold start <path> name=ms …` and X-Ray subsegments. `ColdStart.Current.Measure("name")` adds a phase; it costs
  nothing after the first request. Measure with Logs Insights on `cold start` and a burst of parallel signed-in
  requests right after a deploy.

## Tests

- API tests use `tests/Tempo.UnitTests/Api/TestApi.cs`: both pools share one local signing key, and the account and
  membership directories and `IAccountService` are NSubstitute substitutes. Extra probe endpoints go in through the
  constructor.
- Every test class that starts the API host carries `[Collection(ApiHostGroup.Name)]`. Parallel hosts trip Serilog's
  static bootstrap logger ("The logger is already frozen"). The real fix in `Program.cs` is still open.
- Database tests (`tests/Tempo.IntegrationTests/DatabaseMigrator/`) call `MigratedDatabase.CreateAsync(postgres)`:
  a fresh migrated database per test on one PostgreSQL 18 container per class. They seed as the superuser (which
  bypasses RLS) and connect as the real runtime roles.

## Dev smoke-test user (day board #60, decision 5)

- One user in `tempo-dev-users`: `yaniv.krispel+tempo-smoke@gmail.com`, email verified, password in SSM
  `/tempo/dev/smoke-test/password` (SecureString), email in `/tempo/dev/smoke-test/email`. Created 2026-10-15.
- Dev's `client-web` app client also allows `ADMIN_USER_PASSWORD_AUTH` (flag `enableSmokeTestSignIn`, never prod),
  which needs IAM credentials, so browsers cannot use it.
- Signed-in smoke check from a developer machine, after a deploy wrote `infrastructure/cdk-outputs.json`:
  `node tools/scripts/smoke-test.mjs --api-url <url> --skip-queue-check --sign-in --profile tempo`.
- CI does not pass `--sign-in` yet: the GitHub deployment role would need `cognito-idp:AdminInitiateAuth` and
  `ssm:GetParameter` on `/tempo/dev/smoke-test/*`, an IAM change that waits for Kris.

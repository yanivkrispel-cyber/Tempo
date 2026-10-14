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
- Links: `ADMIN_APP_URL` / `CLIENT_APP_URL` (`AppLinks`). Client invitations and join links go to the client app,
  staff and admin invitations to the admin app. CDK takes both origins from the first Cognito callback URL of each app.
- Preview and accept calls pass `IAttemptLimiter` first: 20 per account per hour in `identity.join_attempts`
  (migration 0003), committed before the work so failed guesses count. Over the limit is 429 with `Retry-After`.
- Accepting or joining twice returns the existing membership; a suspended membership or studio is 403.

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

## Tests

- API tests use `tests/Tempo.UnitTests/Api/TestApi.cs`: both pools share one local signing key, and the account and
  membership directories and `IAccountService` are NSubstitute substitutes. Extra probe endpoints go in through the
  constructor.
- Every test class that starts the API host carries `[Collection(ApiHostGroup.Name)]`. Parallel hosts trip Serilog's
  static bootstrap logger ("The logger is already frozen"). The real fix in `Program.cs` is still open.
- Database tests (`tests/Tempo.IntegrationTests/DatabaseMigrator/`) call `MigratedDatabase.CreateAsync(postgres)`:
  a fresh migrated database per test on one PostgreSQL 18 container per class. They seed as the superuser (which
  bypasses RLS) and connect as the real runtime roles.

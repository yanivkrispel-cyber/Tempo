# Tempo Repository and Solution Structure

> **Status:** Accepted implementation baseline  
> **Audience:** Developers, architects, QA, DevOps, Codex, Claude and other AI coding agents  
> **Scope:** Phase 1 — Repository structure, solution boundaries and development working agreement  
> **Cloud:** AWS only  
> **Architecture:** Serverless-first modular monolith  
> **Backend:** .NET LTS on AWS Lambda  
> **Frontend:** React + TypeScript  
> **Infrastructure as Code:** AWS CDK in TypeScript  
> **Repository Strategy:** Monorepo  

---

## 1. Purpose

This document defines the mandatory repository structure, dependency rules, module boundaries, project organization and working conventions for Tempo.

It is the source of truth for:

- Human developers.
- Codex.
- Claude.
- Other AI coding agents.
- Pull request reviewers.
- Architecture validation.
- CI/CD implementation.
- Future vertical modules.

All generated code, tasks and pull requests must comply with this document and with the accepted ADRs under `docs/ADR`.

When this document conflicts with an accepted ADR, the ADR takes precedence.

---

## 2. Repository Strategy

Tempo must be implemented in a single monorepo.

The monorepo contains:

- Frontend applications.
- Backend API.
- Background workers.
- Database migrator.
- Platform Core modules.
- Shared contracts.
- AWS CDK infrastructure.
- Tests.
- API and event schemas.
- Engineering tools.
- Architecture and product documentation.

A separate repository must not be created for each vertical, module, Lambda function or frontend application during the initial implementation stages.

### Rationale

The monorepo enables:

- Synchronized API and frontend changes.
- End-to-end feature pull requests.
- Shared package and dependency management.
- Centralized architecture rules.
- Easier work across two developers.
- Better context for AI coding agents.
- Atomic changes across backend, frontend, infrastructure, contracts and tests.

---

## 3. Mandatory Root Structure

```text
tempo/
│
├── apps/
│   ├── admin-web/
│   ├── client-web/
│   └── platform-admin-web/
│
├── backend/
│   ├── Tempo.Api/
│   ├── Tempo.Worker/
│   ├── Tempo.DatabaseMigrator/
│   ├── Tempo.Platform/
│   └── Tempo.Contracts/
│
├── infrastructure/
│   ├── bin/
│   ├── lib/
│   ├── config/
│   └── test/
│
├── tests/
│   ├── Tempo.UnitTests/
│   ├── Tempo.IntegrationTests/
│   ├── Tempo.ArchitectureTests/
│   ├── Tempo.ContractTests/
│   └── Tempo.EndToEndTests/
│
├── contracts/
│   ├── openapi/
│   ├── events/
│   └── schemas/
│
├── tools/
│   ├── scripts/
│   ├── local-development/
│   └── database/
│
├── docs/
│   ├── ADR/
│   ├── LLD/
│   └── diagrams/
│
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   ├── pull_request_template.md
│   └── CODEOWNERS
│
├── Directory.Build.props
├── Directory.Packages.props
├── global.json
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.local.yml
├── .editorconfig
├── .gitignore
├── README.md
└── Tempo.sln
```

---

## 4. Frontend Applications

### 4.1 `apps/admin-web`

The business administration application.

Primary users:

- Organization owners.
- Organization administrators.
- Managers.
- Staff.
- Reception and operational users.

Expected capabilities:

- Organization management.
- Staff and memberships.
- People and clients.
- Roles and permissions.
- Platform billing.
- Settings.
- Future CRM.
- Future scheduling.
- Future studio, coaching and vertical operations.

### 4.2 `apps/client-web`

The client-facing PWA.

Primary users:

- Members.
- Athletes.
- Patients.
- Clients.
- Guardians.
- Payers.

The application displays only capabilities enabled for the relevant organization and vertical product.

Expected capabilities include:

- Schedule.
- Classes.
- Workouts.
- Appointments.
- Payments.
- Documents.
- Notifications.
- Personal profile.

### 4.3 `apps/platform-admin-web`

The internal Tempo operations application.

Primary users:

- Tempo support.
- Tempo operations.
- Tempo finance.
- Tempo security.
- Platform administrators.

Expected capabilities:

- Tenant search and support.
- Subscription operations.
- Operational diagnostics.
- Failed jobs and dead-letter queues.
- Integration diagnostics.
- Controlled impersonation.
- Audit investigation.
- Platform dashboards.

This application is never exposed as an ordinary organization-management surface.

---

## 5. Frontend Internal Structure

Each frontend application must follow this structure:

```text
apps/admin-web/
├── public/
├── src/
│   ├── app/
│   │   ├── providers/
│   │   ├── routing/
│   │   ├── layouts/
│   │   └── bootstrap/
│   │
│   ├── features/
│   │   ├── authentication/
│   │   ├── organizations/
│   │   ├── memberships/
│   │   ├── people/
│   │   ├── authorization/
│   │   └── billing/
│   │
│   ├── shared/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── components/
│   │   ├── design-system/
│   │   ├── forms/
│   │   ├── hooks/
│   │   ├── i18n/
│   │   ├── telemetry/
│   │   └── utilities/
│   │
│   ├── main.tsx
│   └── vite-env.d.ts
│
├── tests/
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### 5.1 Feature Structure

Each feature should be isolated:

```text
features/organizations/
├── api/
├── components/
├── hooks/
├── pages/
├── schemas/
├── types/
└── index.ts
```

### 5.2 Frontend Dependency Rules

- A feature must not import another feature's private implementation.
- Cross-feature usage must go through the feature's public `index.ts`.
- Shared generic code belongs under `shared`.
- Business-specific logic must not be moved to `shared`.
- Authorization must always be enforced by the backend.
- UI visibility is not a security boundary.
- API calls must use the centralized API client.
- Direct `fetch` calls outside the API client are prohibited.
- Frontend code must support RTL and LTR from the beginning.
- Components must meet accessibility requirements.

---

## 6. Backend Projects

```text
backend/
├── Tempo.Api/
├── Tempo.Worker/
├── Tempo.DatabaseMigrator/
├── Tempo.Platform/
└── Tempo.Contracts/
```

---

## 7. `Tempo.Api`

`Tempo.Api` is the HTTP application entry point running on AWS Lambda behind Amazon API Gateway HTTP API.

```text
Tempo.Api/
├── Configuration/
├── Middleware/
├── Authentication/
├── TenantResolution/
├── ErrorHandling/
├── Observability/
├── Endpoints/
├── DependencyInjection/
├── LambdaEntryPoint.cs
├── Program.cs
└── Tempo.Api.csproj
```

### Responsibilities

- Application bootstrapping.
- Dependency injection.
- HTTP routing.
- Cognito JWT validation integration.
- Correlation ID handling.
- Tenant context resolution.
- Error-to-Problem-Details mapping.
- OpenAPI exposure.
- Request-level observability.

### Prohibited Responsibilities

- Domain rules.
- Database queries.
- Repository access from endpoints.
- Provider-specific business logic.
- Tenant authorization implemented only in endpoint code.
- Cross-module direct persistence access.

The API layer must remain thin.

---

## 8. `Tempo.Worker`

`Tempo.Worker` is the entry point for asynchronous Lambda workloads.

```text
Tempo.Worker/
├── Consumers/
│   ├── Outbox/
│   ├── Notifications/
│   ├── Webhooks/
│   ├── Files/
│   └── Billing/
│
├── JobExecution/
├── Observability/
├── DependencyInjection/
├── LambdaEntryPoint.cs
└── Tempo.Worker.csproj
```

### Responsibilities

- Amazon SQS consumers.
- Amazon EventBridge handlers.
- Outbox publication.
- Notification delivery.
- Webhook processing.
- File-processing workflows.
- Imports and exports.
- Billing reconciliation.
- Scheduled jobs.
- Retry-safe processing.
- Dead-letter handling support.

### Mandatory Consumer Properties

Every consumer must be:

- Idempotent.
- Tenant-aware.
- Observable.
- Safe for duplicate delivery.
- Safe for retry.
- Bounded by timeout.
- Cancellation-aware.
- Correlated by trace and correlation ID.

---

## 9. `Tempo.DatabaseMigrator`

Database migrations must run through a dedicated executable.

```text
Tempo.DatabaseMigrator/
├── Commands/
├── Configuration/
├── MigrationRunner.cs
├── Program.cs
└── Tempo.DatabaseMigrator.csproj
```

### Rules

- The API must not run migrations at startup.
- Lambda invocation must not trigger schema migration.
- Migrations are executed as an explicit CI/CD stage.
- Production migrations require review and approval.
- Breaking changes must use expand/migrate/contract.
- Backfills must be restartable and idempotent.
- Migration results must be logged and auditable.

---

## 10. `Tempo.Platform`

`Tempo.Platform` contains the application core.

```text
Tempo.Platform/
├── BuildingBlocks/
├── Modules/
└── Tempo.Platform.csproj
```

---

## 11. Building Blocks

```text
BuildingBlocks/
├── Domain/
│   ├── AggregateRoot.cs
│   ├── Entity.cs
│   ├── ValueObject.cs
│   ├── DomainEvent.cs
│   └── DomainException.cs
│
├── Application/
│   ├── ICommand.cs
│   ├── ICommandHandler.cs
│   ├── IQuery.cs
│   ├── IQueryHandler.cs
│   ├── Result.cs
│   └── Validation/
│
├── Infrastructure/
│   ├── Persistence/
│   ├── Messaging/
│   ├── Serialization/
│   └── Time/
│
├── Tenancy/
│   ├── TenantContext.cs
│   ├── ITenantContextAccessor.cs
│   └── TenantRequiredException.cs
│
├── Authorization/
│   ├── Permission.cs
│   ├── AuthorizationRequirement.cs
│   └── IAuthorizationService.cs
│
├── Observability/
├── Idempotency/
└── Outbox/
```

### Building-Block Rules

Building blocks contain reusable technical patterns only.

They must not contain:

- Organization business rules.
- Membership business rules.
- User lifecycle rules.
- Studio logic.
- Scheduling logic.
- Payment rules.
- CRM rules.
- Coaching logic.
- Vertical-specific terminology.

A class must not be moved to `BuildingBlocks` merely because it is used by two modules. Shared business meaning must first be reviewed as a possible shared bounded context.

---

## 12. Platform Modules

```text
Tempo.Platform/
└── Modules/
    ├── Identity/
    ├── Organizations/
    ├── Authorization/
    ├── People/
    ├── PlatformBilling/
    ├── Entitlements/
    ├── Communications/
    ├── Files/
    ├── Integrations/
    ├── Audit/
    └── PlatformAdministration/
```

Future shared capabilities and verticals are added as explicit modules.

---

## 13. Standard Module Structure

Every module must use a consistent structure:

```text
Modules/Organizations/
├── Domain/
│   ├── Aggregates/
│   ├── Entities/
│   ├── ValueObjects/
│   ├── Events/
│   ├── Policies/
│   └── Errors/
│
├── Application/
│   ├── Commands/
│   ├── Queries/
│   ├── Services/
│   ├── Interfaces/
│   ├── Validators/
│   └── Models/
│
├── Infrastructure/
│   ├── Persistence/
│   │   ├── Configurations/
│   │   ├── Repositories/
│   │   └── Migrations/
│   ├── Integrations/
│   └── DependencyInjection/
│
├── Contracts/
│   ├── Requests/
│   ├── Responses/
│   ├── Events/
│   └── Errors/
│
├── Api/
│   ├── Endpoints/
│   └── Mapping/
│
└── OrganizationsModule.cs
```

---

## 14. Layer Dependency Rules

```text
Api
  ↓
Application
  ↓
Domain

Infrastructure
  ↓
Application + Domain
```

### Mandatory Rules

- `Domain` must not reference AWS SDKs.
- `Domain` must not reference Entity Framework.
- `Domain` must not reference HTTP.
- `Domain` must not reference Lambda.
- `Application` must not reference Lambda entry points.
- `Api` must not access the database directly.
- A module must not reference another module's `Infrastructure`.
- A module must not use another module's domain entities.
- Cross-module synchronous communication uses public application contracts.
- Cross-module asynchronous communication uses versioned events.
- Shared contracts must not expose persistence entities.
- Provider SDK models must not enter the domain layer.

These rules must be enforced through architecture tests.

---

## 15. `Tempo.Contracts`

```text
Tempo.Contracts/
├── Api/
│   ├── Common/
│   ├── Identity/
│   ├── Organizations/
│   └── Memberships/
│
├── Events/
│   ├── Identity/
│   ├── Organizations/
│   └── Billing/
│
└── Tempo.Contracts.csproj
```

### Allowed Content

- Public API contracts.
- Integration-event contracts.
- Shared error contracts.
- Pagination contracts.
- Stable public enums.

### Prohibited Content

- Domain entities.
- ORM entities.
- Repositories.
- Internal commands.
- Provider SDK objects.
- Unversioned event payloads.
- Arbitrary helper classes.

---

## 16. Infrastructure Project

AWS infrastructure is implemented using AWS CDK in TypeScript.

```text
infrastructure/
├── bin/
│   └── tempo.ts
│
├── lib/
│   ├── foundations/
│   │   ├── account-baseline-stack.ts
│   │   └── tagging.ts
│   │
│   ├── identity/
│   │   └── identity-stack.ts
│   │
│   ├── data/
│   │   ├── database-stack.ts
│   │   └── storage-stack.ts
│   │
│   ├── api/
│   │   └── api-stack.ts
│   │
│   ├── async/
│   │   ├── messaging-stack.ts
│   │   └── scheduler-stack.ts
│   │
│   ├── frontend/
│   │   └── frontend-stack.ts
│   │
│   ├── observability/
│   │   └── observability-stack.ts
│   │
│   └── tempo-stage.ts
│
├── config/
│   ├── development.ts
│   ├── staging.ts
│   └── production.ts
│
├── test/
│   ├── unit/
│   └── snapshots/
│
├── cdk.json
├── package.json
└── tsconfig.json
```

---

## 17. CDK Stack Boundaries

Initial stack division:

```text
IdentityStack
DataStack
StorageStack
MessagingStack
ApiStack
FrontendStack
ObservabilityStack
```

### Stack Rules

- Do not create one giant stack.
- Do not create dozens of tiny stacks.
- A stack must have a clear ownership and lifecycle boundary.
- Cross-stack outputs must be minimized.
- Secrets must not be passed through plain CDK context.
- Environment-specific configuration must be typed.
- Production resources must use safe removal policies.
- Every resource must include required tags.
- Manual production resource creation is prohibited.

---

## 18. Tests Structure

```text
tests/
├── Tempo.UnitTests/
├── Tempo.IntegrationTests/
├── Tempo.ArchitectureTests/
├── Tempo.ContractTests/
└── Tempo.EndToEndTests/
```

### 18.1 Unit Tests

Cover:

- Aggregates.
- Entities.
- Value objects.
- Domain policies.
- State transitions.
- Command handlers without infrastructure.
- Validation.
- Idempotency decisions.

### 18.2 Integration Tests

Cover:

- PostgreSQL.
- Repositories.
- Row-Level Security.
- Migrations.
- Outbox.
- Inbox.
- SQS consumers.
- Cognito adapter boundaries.
- API persistence.
- File metadata and signed URL behavior.

### 18.3 Architecture Tests

Must verify:

- Domain does not depend on Infrastructure.
- Modules do not depend on another module's Infrastructure.
- API endpoints do not use repositories directly.
- Vertical modules do not leak into Platform Core.
- Tenant-scoped repositories require tenant context.
- Contracts do not expose ORM or domain entities.
- AWS SDK references are absent from Domain.

### 18.4 Contract Tests

Cover:

- OpenAPI compatibility.
- Generated clients.
- Event schemas.
- Provider webhook fixtures.
- Backward compatibility.

### 18.5 End-to-End Tests

Cover:

- Sign in.
- Create organization.
- Invite user.
- Accept invitation.
- Resolve organization context.
- Validate permissions.
- Validate cross-tenant isolation.
- Validate audit event.
- Validate deployment smoke path.

---

## 19. Contracts Directory

```text
contracts/
├── openapi/
│   ├── tempo-api-v1.yaml
│   └── platform-admin-v1.yaml
│
├── events/
│   ├── organization-created.v1.json
│   ├── membership-invited.v1.json
│   └── membership-activated.v1.json
│
└── schemas/
    ├── problem-details.json
    ├── event-envelope.json
    └── pagination.json
```

### Contract Rules

- OpenAPI files are the source of truth for external HTTP contracts.
- Every integration event requires a versioned schema.
- Event filenames include version.
- DTOs may be generated from contracts or validated against them.
- Breaking contract changes require a new version and review.
- Events are facts written in past tense.
- Event payloads must minimize sensitive data.

---

## 20. Tools Directory

```text
tools/
├── scripts/
│   ├── build.sh
│   ├── test.sh
│   ├── deploy-dev.sh
│   └── generate-api-client.sh
│
├── local-development/
│   ├── init-local-db.sql
│   ├── localstack/
│   └── seed/
│
└── database/
    ├── verify-migrations.sh
    ├── reset-local-db.sh
    └── generate-test-data.sh
```

### Rules

- Scripts must work locally and in CI.
- Scripts must fail on error.
- Scripts must not contain secrets.
- Destructive scripts require explicit confirmation.
- Local seed data must be synthetic.
- Production data must not be copied into local environments.

---

## 21. GitHub Structure

```text
.github/
├── workflows/
│   ├── pull-request.yml
│   ├── deploy-development.yml
│   ├── deploy-staging.yml
│   ├── deploy-production.yml
│   └── security-scan.yml
│
├── ISSUE_TEMPLATE/
├── pull_request_template.md
└── CODEOWNERS
```

### Workflow Responsibilities

#### `pull-request.yml`

- Restore dependencies.
- Format and lint.
- Compile.
- Unit tests.
- Architecture tests.
- Integration tests where applicable.
- Security scan.
- Secret scan.
- OpenAPI validation.
- Event-schema validation.
- CDK test.
- CDK synth.
- CDK diff.

#### `deploy-development.yml`

- Build immutable artifacts.
- Run approved migrations.
- Deploy development.
- Run smoke tests.
- Publish deployment metadata.

#### `deploy-staging.yml`

- Deploy release candidate.
- Execute full integration and end-to-end tests.
- Validate migrations.
- Run operational checks.

#### `deploy-production.yml`

- Require protected-environment approval.
- Assume AWS production role through OIDC.
- Execute controlled migration.
- Deploy immutable artifacts.
- Run smoke tests.
- Monitor alarms.
- Support rollback or forward-fix.

---

## 22. Dependency Management

### 22.1 Backend

Use:

- `Directory.Packages.props` for centralized NuGet versions.
- `Directory.Build.props` for shared compiler, analyzer and build settings.
- `global.json` for the selected .NET SDK.

Example:

```xml
<Project>
  <ItemGroup>
    <PackageVersion Include="Microsoft.EntityFrameworkCore" Version="..." />
    <PackageVersion Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="..." />
    <PackageVersion Include="Amazon.Lambda.AspNetCoreServer" Version="..." />
  </ItemGroup>
</Project>
```

Individual projects must not choose conflicting versions.

### 22.2 Frontend and Infrastructure

Use pnpm workspaces.

```yaml
packages:
  - "apps/*"
  - "infrastructure"
  - "packages/*"
```

The repository root manages shared scripts and dependency policies.

---

## 23. Branching Strategy

Use trunk-based development with short-lived branches.

```text
main
  ├── feature/organization-create
  ├── feature/member-invitation
  ├── fix/tenant-isolation
  └── chore/update-cdk
```

### Rules

- `main` must always be deployable.
- Direct commits to `main` are prohibited.
- Every change requires a pull request.
- Pull requests should be small and cohesive.
- Migrations must be reviewed.
- Architecture tests are mandatory.
- Production deployment uses an approved release or protected workflow.
- Long-lived environment branches are prohibited unless explicitly approved.

---

## 24. Work Division Between Developers

The monorepo supports parallel work.

Example ownership:

### Developer 1

- Backend modules.
- Database.
- API.
- Cognito integration.
- Tenant enforcement.
- Authorization.

### Developer 2

- Frontend shell.
- Authentication UI.
- Organization UI.
- API client.
- Frontend infrastructure.
- Design system.

Ownership should remain feature-oriented when practical.

A complete feature pull request may include:

```text
backend module
API endpoint
OpenAPI contract
frontend page
integration test
CDK configuration
documentation
```

---

## 25. Mandatory Repository Rules

1. Do not create a separate repository for each vertical.
2. Do not create a separate repository for each microservice.
3. Do not place production code outside `apps`, `backend` or `infrastructure`.
4. Frontends must never access databases directly.
5. Lambda handlers must not contain domain logic.
6. Domain projects must not reference AWS SDKs.
7. APIs must not exist only as undocumented controller code.
8. Every external event must have a versioned schema.
9. API startup must not run database migrations.
10. Architectural changes require an ADR.
11. Tenant-owned data must always carry tenant ownership.
12. Authorization must be enforced server-side.
13. Secrets must never be committed.
14. Provider SDK objects must not become domain entities.
15. New behavior requires tests.
16. Cross-module direct table access is prohibited.
17. Public contracts require compatibility review.
18. Background consumers must be idempotent.
19. All external I/O must use timeout and cancellation.
20. Logging must be structured and must not expose sensitive data.

---

## 26. AI Coding Agent Instructions

Codex, Claude and other coding agents must follow this sequence before making changes:

1. Read this document.
2. Read `docs/ADR/README.md`.
3. Read all ADRs relevant to the requested task.
4. Read the relevant LLD.
5. Inspect existing code patterns.
6. Inspect tests for the affected module.
7. Produce a change plan before implementation.
8. Implement the smallest cohesive change.
9. Add or update tests.
10. Update contracts and documentation.
11. Report assumptions, risks and remaining work.

### Required Agent Change Plan

```text
Goal
Affected modules
Domain invariants
Authorization impact
Tenant impact
Database changes
API changes
Event changes
AWS infrastructure changes
Failure behavior
Observability
Tests
Migration and rollout
```

### Agent Prohibitions

An AI coding agent must not:

- Bypass tenant context.
- Remove authorization checks.
- Expose internal errors.
- Access another module's private database tables.
- Add AWS SDK dependencies to Domain.
- Add direct provider dependencies to vertical business logic.
- Create a new shared abstraction without proving it is truly shared.
- Introduce Redis, RDS Proxy, ECS, EKS or another database without an ADR.
- Change a public API or event schema silently.
- Create destructive migrations without a safe rollout.
- Mark a task complete without listing tests executed.
- Claim production readiness without passing the documented gates.
- Store credentials in source code, configuration files or CI variables.

### Required Agent Completion Report

Every completed coding task must report:

```text
Files changed
Behavior implemented
Architecture decisions followed
Assumptions
Tests added
Tests executed and results
Migrations
Contract changes
Security impact
Known risks
Remaining work
```

---

## 27. Phase 1 Repository Deliverables

This repository-structure phase is complete when the repository contains:

- Root folder structure.
- `Tempo.sln`.
- Base .NET projects.
- Three base frontend applications.
- AWS CDK project.
- Test projects.
- OpenAPI placeholder.
- Event envelope schema.
- `.editorconfig`.
- Central package management.
- Base GitHub workflows.
- Root README.
- CODEOWNERS.
- Initial architecture tests.
- Local development scripts.

---

## 28. Required Local Commands

The following commands must succeed:

```bash
dotnet restore
dotnet build
dotnet test

pnpm install
pnpm build
pnpm test

cd infrastructure
pnpm test
npx cdk synth
```

The repository should also expose root-level wrapper commands so developers do not need to know every project detail.

Recommended root scripts:

```text
pnpm bootstrap
pnpm build
pnpm test
pnpm lint
pnpm contracts:validate
pnpm cdk:synth
```

---

## 29. Pull Request Quality Gate

Every pull request must pass:

```text
Restore dependencies
→ Compile backend
→ Build frontends
→ Run unit tests
→ Run architecture tests
→ Run relevant integration tests
→ Validate OpenAPI
→ Validate event schemas
→ Scan dependencies
→ Scan secrets
→ Run CDK tests
→ Run CDK synth
→ Publish results
```

A pull request must not be merged when:

- Required tests fail.
- Tenant-isolation coverage is missing.
- A new public contract is undocumented.
- A migration is unsafe.
- An ADR is required but absent.
- Security findings are unresolved.
- The change breaks module dependency rules.

---

## 30. Definition of Done

Phase 1 is considered complete when:

- The entire repository can be restored, built and tested from a clean machine.
- CI executes the required quality gate.
- The base applications deploy to a development AWS account.
- Architecture tests enforce dependency rules.
- AI agents can identify the correct location for every new file.
- No ambiguous ownership exists between Platform Core and vertical modules.
- The repository documentation and accepted ADRs are internally consistent.

---

## 31. Next Step

After this repository baseline is created, the next document and implementation phase is:

```text
AWS Infrastructure LLD
→ Accounts and environments
→ Networking
→ Lambda
→ API Gateway
→ Aurora PostgreSQL
→ SQS and EventBridge
→ S3 and CloudFront
→ Cognito
→ CloudWatch
→ CDK deployment structure
```

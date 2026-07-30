# Backend Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Architectural Pattern

Use Clean/Hexagonal boundaries inside a modular monolith:

```text
Modules/<Module>/
  Domain/
  Application/
  Infrastructure/
  Contracts/
  Api/
```

Dependencies:

```text
Api → Application → Domain
Infrastructure → Application + Domain
Contracts are stable public module contracts
Domain has no infrastructure dependencies
```

## 2. Request Handling

1. Endpoint validates transport concerns.
2. Authentication and tenant context resolved by middleware.
3. DTO maps to command/query.
4. Authorization policy runs.
5. Application handler begins transaction when required.
6. Domain executes invariant-bearing behavior.
7. Repository saves aggregate.
8. Outbox records integration events.
9. Handler returns contract result.
10. Exception middleware maps to Problem Details.

## 3. Error Contract

```json
{
  "type": "https://docs.tempo.app/errors/membership-not-found",
  "title": "Membership not found",
  "status": 404,
  "code": "membership.not_found",
  "traceId": "01H...",
  "errors": []
}
```

Never expose stack traces, SQL, provider secrets or internal host names.

## 4. Transactions

- One DB transaction per command by default.
- Query contexts are read-only where supported.
- Outbox in same transaction.
- Provider calls outside DB transactions.
- Optimistic concurrency.
- bounded retry for transient transaction failures.

## 5. Persistence

- Repositories persist aggregates.
- Query handlers may use optimized read SQL.
- ORM allowed for aggregate persistence.
- forward-only production migrations.
- expand/migrate/contract for breaking changes.

## 6. Dependency Injection and Configuration

- Constructor injection.
- No service locator.
- Strongly typed startup validation.
- Secrets from secret manager.
- Feature toggles through interface.

## 7. Provider Adapters

```csharp
public interface IEmailProvider
{
    Task<ProviderSendResult> SendAsync(
        EmailMessage message,
        IdempotencyKey key,
        CancellationToken cancellationToken);
}
```

Every adapter defines timeout, circuit breaker, retry classification, idempotency, logs, metrics and normalized errors.

## 8. Project Layout

```text
src/
  Tempo.Api/
  Tempo.Worker/
  Tempo.Platform/
    BuildingBlocks/
    Modules/
      Identity/
      Organizations/
      Authorization/
      People/
      Billing/
      Entitlements/
      Communications/
      Files/
      Integrations/
      Audit/
      PlatformAdministration/
  Tempo.Contracts/
tests/
  Unit/
  Integration/
  Architecture/
  EndToEnd/
```

## 9. Performance Rules

- avoid N+1.
- paginate.
- cursor pagination for large mutable lists.
- no domain entities as API output.
- request/upload limits.
- cache stable configuration.
- cancellation tokens.
- p50/p95/p99 telemetry.

## 10. Architecture Tests

- Domain cannot reference Infrastructure.
- Modules cannot reference another module's Infrastructure.
- Endpoints cannot access repositories directly.
- Contracts cannot reference ORM entities.
- Tenant repositories require tenant context.

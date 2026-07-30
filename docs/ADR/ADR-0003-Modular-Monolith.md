# ADR-0003: Modular Monolith with Event-Driven Boundaries

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture
- **Related:** ADR-0002, ADR-0008

## Context

Tempo contains multiple bounded contexts but does not yet have independent teams, load profiles or availability requirements that justify microservices.

A loose monolith would create coupling, while microservices would add distributed transactions, network failure modes, deployments and observability overhead.

## Decision

Implement the synchronous backend as a modular monolith with explicit bounded contexts.

Initial modules include:

- Identity.
- Organizations.
- Authorization.
- People.
- Platform Billing.
- Entitlements.
- Communications.
- Files.
- Integrations.
- Audit.
- Platform Administration.
- Future shared capabilities and vertical modules.

## Module Rules

- A module owns its domain model and database schema.
- Direct queries into another module's private tables are prohibited.
- Synchronous access uses public application interfaces.
- Asynchronous communication uses versioned integration events.
- Domain code does not depend on AWS SDKs or provider contracts.
- Architecture tests enforce dependency direction.
- Cross-module transactions require explicit design review.
- Shared utility packages may not contain business rules.

## Deployment Interpretation

“Modular monolith” describes code ownership and domain boundaries. It does not require one physical Lambda package forever.

The API may initially deploy as one function to minimize complexity. Modules or workloads may be split into separate functions/services while preserving contracts.

## Consequences

### Positive

- Strong consistency within modules.
- Simple local development and testing.
- Low operational overhead.
- Easier domain evolution.
- Controlled path to service extraction.

### Negative

- Shared deployment blast radius.
- Requires discipline and automated architecture tests.
- Poorly designed internal interfaces can still create coupling.

## Service Extraction Criteria

- Independent scaling.
- Different runtime.
- distinct security boundary.
- independent team ownership.
- unacceptable shared deployment risk.
- significantly different availability target.

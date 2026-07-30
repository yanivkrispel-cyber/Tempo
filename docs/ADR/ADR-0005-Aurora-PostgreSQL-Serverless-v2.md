# ADR-0005: Aurora PostgreSQL Serverless v2 as the Primary Transactional Database

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Data Engineering, Platform Engineering
- **Related:** ADR-0002, ADR-0006, ADR-0013

## Context

Tempo's Platform Core and shared business capabilities are relational. They require transactions, uniqueness, foreign keys, flexible querying, reporting, concurrency control and multi-tenant safeguards.

Aurora PostgreSQL Serverless v2 provides PostgreSQL compatibility and managed scaling. Supported engine versions can use a minimum capacity of zero ACUs and auto-pause, which is useful for non-production environments that tolerate resume latency.

## Decision

Use Amazon Aurora PostgreSQL Serverless v2 as the primary transactional database.

## Environment Configuration Direction

### Development and test

- Minimum capacity: 0 ACU only on Aurora PostgreSQL engine versions that support auto-pause.
- Auto-pause enabled.
- Maximum capacity kept low and controlled.
- No reader instance by default.
- Automated teardown for ephemeral environments.

### Production initial stage

- Auto-pause disabled.
- Non-zero minimum capacity.
- One writer instance.
- No reader until availability/load evidence requires it.
- Point-in-time recovery enabled.
- Deletion protection enabled.
- Encryption with KMS.
- Automated backups, point-in-time recovery and recurring restore tests.

### Production growth stage

Add a reader/failover instance when:

- Commercial SLO requires faster failover.
- Read workload materially affects writer.
- Restore/failover exercises justify the cost.

## Database Rules

- PostgreSQL schemas are owned by modules.
- Tenant records include immutable `organization_id`.
- Use constraints and Row-Level Security as defense in depth.
- Money uses integer minor units and currency code.
- Timestamps use UTC `timestamptz`.
- Migrations use expand/migrate/contract.
- Database calls are bounded and observable.

## Alternatives Considered

### DynamoDB as the Core Database

Rejected because the core contains highly relational and evolving queries. DynamoDB may be introduced for access patterns that clearly benefit from it.

### RDS PostgreSQL

A valid simpler alternative. Aurora Serverless v2 is selected for managed scaling and future availability options. Cost must be monitored against RDS.

### Database per Tenant

Rejected as the default because it increases operations and migrations significantly.

## Consequences

### Positive

- Strong relational model.
- Managed storage and backups.
- Transactional outbox support.
- PostgreSQL ecosystem.
- Scaling range configurable per environment.

### Negative

- Database introduces baseline production cost.
- Lambda concurrency can overwhelm connections.
- Aurora may be more expensive than small RDS instances at certain steady loads.
- Auto-pause is unsuitable for latency-sensitive production.

## Implementation Gate

Before provisioning production, Platform Engineering must compare the current monthly cost of the selected Aurora Serverless v2 capacity range with an appropriately sized RDS PostgreSQL instance. Aurora remains the default unless the measured cost difference is material and RDS satisfies the same SLO, recovery and scaling requirements.

## Review Trigger

Compare Aurora cost/performance with RDS PostgreSQL after real production usage is available, and whenever database compute becomes a top-three AWS cost item.

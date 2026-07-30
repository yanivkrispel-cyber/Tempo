# ADR-0013: Do Not Introduce Redis or RDS Proxy Initially

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Platform Engineering
- **Related:** ADR-0002, ADR-0005

## Context

ElastiCache and RDS Proxy introduce additional recurring cost and operational components. Early usage does not yet demonstrate a need for distributed cache or connection proxying.

RDS Proxy can maintain database connections that conflict with cost-saving auto-pause behavior in non-production Aurora configurations.

## Decision

Do not deploy Amazon ElastiCache or Amazon RDS Proxy in the initial architecture.

## Initial Alternatives

- CloudFront caching for static/public HTTP content.
- Safe in-process cache inside warm Lambda environments for non-critical immutable data.
- PostgreSQL entitlement snapshots and read models.
- Database constraints/advisory locks for limited coordination.
- API Gateway/WAF rate controls.
- Reserved Lambda concurrency to protect database connections.
- Small database connection pools and connection reuse.

## Add Redis When

- Measured hot-read latency or database load justifies it.
- Distributed coordination cannot be safely handled by database constraints.
- High-rate tenant-aware rate limiting is required.
- Real-time presence/session use case exists.
- Cost model demonstrates benefit.

## Add RDS Proxy When

- Connection exhaustion occurs despite concurrency controls.
- Failover behavior materially improves.
- Connection churn is measured as a dominant problem.
- Auto-pause tradeoff is accepted for the environment.

## Consequences

- Lower cost and fewer moving parts.
- Application must carefully manage Lambda/database concurrency.
- A later addition requires cache invalidation and failure-mode design.

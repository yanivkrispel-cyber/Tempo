# ADR-0006: Shared-Schema Multi-Tenancy with Defense in Depth

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Security, Data Engineering
- **Related:** ADR-0005, ADR-0007

## Context

Tempo must isolate many small and medium organizations while keeping cost and operations manageable.

A database or schema per tenant would increase migration, connection, backup and observability complexity. Application-only `WHERE organization_id = ...` checks are insufficient as the sole control.

## Decision

Use shared module schemas and shared tables with immutable `organization_id` on tenant-owned records.

Tenant isolation is enforced through:

1. Authenticated principal.
2. Server-side tenant resolution.
3. Active organization membership or platform privilege.
4. Authorization policy.
5. Tenant-aware repositories.
6. PostgreSQL Row-Level Security where applicable.
7. Tenant-leading constraints and indexes.
8. Automated cross-tenant security tests.
9. Tenant-scoped cache, queue, search and file keys.

## Tenant Context

Every request/job includes:

- Organization ID.
- User ID or platform actor ID.
- Membership ID where applicable.
- Correlation ID.
- Impersonation session ID when applicable.

Missing or inconsistent tenant context fails closed.

## Platform Operator Access

Platform operators use separate roles and audited support sessions. They do not receive ordinary tenant membership simply to support an organization.

## Consequences

### Positive

- Cost-efficient.
- One migration path.
- Simple tenant provisioning.
- Supports platform analytics through governed pipelines.

### Negative

- A scoping defect can have severe impact.
- RLS/session handling requires careful implementation.
- Noisy tenants require monitoring and limits.

## Mandatory Tests

- Cross-tenant ID enumeration.
- Writes with foreign IDs.
- Background-job tenant mismatch.
- Cache-key collision.
- Export and search isolation.
- Impersonation restrictions.

## Amendment 2026-10-14: Structural Isolation First, RLS as the Second Layer

Council decision Q6 (2026-10-13) made structural isolation the primary control, because Aurora DSQL had no RLS: an immutable `organization_id`, tenant-leading composite primary and foreign keys, and tenant-aware repositories. On Neon (ADR-0022) RLS is available again, and the owners chose on 2026-10-14 to keep both:

- Structural isolation stays mandatory on every tenant-owned table.
- RLS policies are added as a second layer, so a query that forgets its tenant filter returns nothing instead of another tenant's rows.
- The API and the Worker connect through Neon's pooler in transaction mode, so the tenant context is set per transaction (`SET LOCAL` or `set_config(..., true)`), never per session.

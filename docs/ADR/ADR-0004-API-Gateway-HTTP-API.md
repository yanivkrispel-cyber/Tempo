# ADR-0004: Amazon API Gateway HTTP API for Public APIs

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Backend Engineering, Security
- **Related:** ADR-0002, ADR-0007, ADR-0009

## Context

Tempo needs a managed public API edge with routing, authorization integration, CORS, throttling, custom domains, access logs and automatic scaling.

API Gateway offers HTTP APIs and REST APIs. HTTP APIs provide a smaller feature set and are designed as a lower-cost option. They support Lambda integrations, OIDC/OAuth authorization and CORS.

## Decision

Use Amazon API Gateway HTTP API as the default ingress for the Tempo application API.

Use REST API only when a required feature is unavailable in HTTP API and an ADR records the exception.

## Responsibilities

API Gateway owns:

- Public HTTPS endpoint.
- Route mapping.
- JWT authorizer integration where suitable.
- CORS policy.
- stage configuration.
- request throttling and quotas where supported.
- access logs.
- custom API domain.

Application code owns:

- Domain authorization.
- Tenant resolution.
- Input validation.
- Idempotency.
- Business errors.
- Audit.
- Resource-level rate policies not handled at the edge.

## API Contract

- OpenAPI 3.x is the contract source.
- API version is included in route, for example `/api/v1`.
- RFC 7807-style Problem Details.
- Correlation ID propagates from edge to all downstream operations.
- Idempotency keys are mandatory for retryable financial and creation commands.

## Alternatives Considered

### Application Load Balancer

Rejected initially because Lambda + HTTP API is simpler and avoids a fixed load-balancer baseline for the public API.

### API Gateway REST API

Not selected by default due to cost and complexity. It may be used for a specific missing capability after review.

## Consequences

- Lower operational burden and automatic scaling.
- API feature selection must remain within HTTP API capabilities.
- Domain authorization cannot be delegated entirely to API Gateway.

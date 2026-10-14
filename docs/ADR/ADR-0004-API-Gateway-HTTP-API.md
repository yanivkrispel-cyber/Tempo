# ADR-0004: Amazon API Gateway HTTP API for Public APIs

- **Status:** Accepted, amended on 2026-10-13: the ingress is now CloudFront with a Lambda Function URL (see the amendment below)
- **Date:** 2026-07-30
- **Owners:** Architecture, Backend Engineering, Security
- **Related:** ADR-0002, ADR-0007, ADR-0009, ADR-0021

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
- JWT authorizer integration for Cognito access-token validation where suitable.
- Explicit CORS policy. Preflight routes must remain unauthenticated when required by the selected route model.
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
- Domain and tenant authorization cannot be delegated entirely to API Gateway. API Gateway validates token authenticity and optional OAuth scopes; Tempo evaluates current membership, permissions and resource scope.

## Amendment 2026-10-13: CloudFront and a Lambda Function URL Instead of API Gateway

### Why

ADR-0021 sets the fixed cost to zero until revenue. This account has no 12-month Free Tier, so HTTP API costs $1.20 per million requests from the first request, and a WAF web ACL in front of it costs $5 a month plus $1 per rule.

The CloudFront flat-rate Free plan covers one distribution with no overage charges. It includes:

- a WAF web ACL with five rules;
- always-on DDoS protection and a TLS certificate;
- the Route 53 hosted zone;
- 1 million requests and 100 GB a month.

Requests that WAF blocks do not count toward that allowance.

### Decision

- **One distribution.** The PWA's CloudFront distribution also serves the API. The `/api/*` behavior points at the API function's Function URL.
  - The Function URL uses `AuthType: AWS_IAM`, and Origin Access Control signs every origin request (origin type `lambda`, signing behavior `always`). The Function URL cannot be called directly.
  - The behavior uses the managed `CachingDisabled` cache policy and the managed `AllViewerExceptHostHeader` origin request policy. The Free plan allows only managed request rules.
- **Token header.** OAC replaces the viewer's `Authorization` header with its own SigV4 signature. The Cognito access token therefore travels in `X-Tempo-Authorization: Bearer <token>`, and ASP.NET Core JwtBearer reads it from there.
- **Request bodies.** Lambda does not accept unsigned payloads through OAC, so a request with a body sends `x-amz-content-sha256` with the SHA-256 of the body. The PWA's shared API client computes it with WebCrypto.
- **Webhooks.** Providers cannot add that header, so webhooks get their own function, outside OAC. It authenticates every request with the provider's signature and an idempotency key. It is designed together with the first provider integration.
- **Plan subscription.** The distribution joins the Free plan through `AWS::PricingPlanManager::Subscription`, which CloudFormation has supported since 2026-09. A paid tier stays in `PENDING_APPROVAL` and bills nothing until someone explicitly approves it.
  - The subscription references the distribution and a WAFv2 web ACL with `CLOUDFRONT` scope.
  - That web ACL exists only in `us-east-1`, so the edge stack is deployed there.
- **Custom domain.** It is added when the domain is bought, before the pilot. Until then the API uses the `*.cloudfront.net` name.
- **Free plan logging.** The plan includes no CloudFront access logs or WAF request logs; those start at Pro. Request logging comes from the API function's structured logs.

### Responsibility Changes

The responsibilities of API Gateway that are listed above move as follows:

| Responsibility | New owner |
|---|---|
| HTTPS endpoint, routing to `/api/*`, TLS | CloudFront |
| JWT validation (issuer, audience, signature, expiry) | The API, with JwtBearer against the Cognito JWKS. Previously the API trusted the claims that API Gateway passed through. |
| Throttling | A WAF rate-based rule for all requests, a stricter one for authentication endpoints, and reserved concurrency on the API function |
| Access logs | The API's structured request log |
| CORS | The API. It is mostly unnecessary, because the PWA and the API share one origin. |

### Exit

When Tempo needs a feature that only API Gateway offers, such as usage plans or API keys for partners, add an HTTP API as a second origin of the same distribution. CloudFront keeps working at pay-as-you-go rates if the plan ever changes.


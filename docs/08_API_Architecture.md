# API Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Styles

- REST/JSON for synchronous operations.
- Webhooks for provider callbacks.
- versioned events for async.
- WebSocket/SSE only when justified.

## 2. URLs

```text
/api/v1/organizations
/api/v1/organizations/{organizationId}/memberships
/api/v1/organizations/{organizationId}/people
/api/v1/platform/tenants
```

Commands may use:

```text
POST /memberships/{id}:activate
POST /subscriptions/{id}:cancel
```

## 3. Headers

- Authorization.
- Idempotency-Key.
- X-Correlation-Id.
- If-Match.
- Accept-Language.

## 4. Problem Details

All errors include stable `code`, HTTP status and trace ID.

## 5. Pagination

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": "opaque",
    "hasNextPage": true
  }
}
```

## 6. Idempotency

Mandatory for payments, invitations, webhooks, imports, file finalization and externally retried commands.

## 7. Concurrency

Use ETag/version + `If-Match` for contested resources.

`If-Match` is optional today on every versioned PUT: without it the last write wins; with a stale version the
API answers 409 `concurrency.conflict` (decision E-1, day board #232). Making it required (428) on all of them is a
later contract change.

## 8. Security

- tenant scope.
- endpoint permission.
- input/body limits.
- rate limits.
- no mass assignment.
- signed file URLs.
- separate platform APIs.

## 9. OpenAPI

Document authorization, schemas, errors, idempotency, events, examples and deprecation.

## 10. Versioning

Additive changes preferred. Breaking external changes require a new version and published sunset.

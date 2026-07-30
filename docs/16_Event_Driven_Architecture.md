# Event-Driven Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Event Types

- Domain Event.
- Integration Event.
- Command Message.
- Provider Event.

## 2. Outbox

Aggregate and outbox saved atomically. Publisher sends at least once. Consumer is idempotent.

## 3. Envelope

```json
{
  "eventId": "uuid",
  "eventType": "organization.member.invited",
  "schemaVersion": 1,
  "occurredAt": "timestamp",
  "organizationId": "uuid|null",
  "correlationId": "string",
  "causationId": "uuid|null",
  "actor": {"type": "user", "id": "uuid"},
  "data": {}
}
```

## 4. Rules

Past tense facts, immutable payloads, duplicate tolerance, no producer-to-consumer dependency, minimal sensitive data and versioned schema.

## 5. Ordering

No global ordering. Partition by subject where necessary, include aggregate version and reconcile gaps.

## 6. Sagas

Only for long-running multi-module flows. Persist saga state, deadlines and compensations.

## 7. Dead Letters

Searchable by tenant, handler, attempts, error, correlation and replay status.

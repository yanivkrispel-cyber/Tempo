# ADR-0008: SQS, EventBridge and Transactional Outbox for Asynchronous Work

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Backend Engineering, Platform Engineering
- **Related:** ADR-0002, ADR-0003, ADR-0005

## Context

Notifications, provider webhooks, imports, exports, files, reconciliation and cross-module reactions must survive process failure and provider outages.

A single messaging service does not optimally cover both durable work queues and event routing/scheduling.

## Decision

Use:

- Amazon SQS Standard as the default durable work queue.
- SQS FIFO only for explicit ordering/deduplication requirements.
- Amazon EventBridge for event routing, AWS integration and schedules.
- A PostgreSQL transactional outbox for publishing events after domain transactions.
- Dead-letter queues for failed messages.
- Idempotent consumers and webhook inbox records.

## Standard Flow

```text
Database transaction
→ Domain state + Outbox row
→ Outbox publisher Lambda
→ EventBridge or SQS
→ Consumer Lambda
→ Idempotent transaction
→ Follow-up outbox event
```

## Delivery Semantics

- At-least-once delivery.
- No global ordering assumption.
- Consumer deduplication.
- Aggregate/version checks where order matters.
- Bounded exponential retry.
- Dead-letter operational workflow.
- Correlation and causation IDs.

## Service Responsibilities

### SQS

- Reliable work distribution.
- Backpressure.
- Consumer scaling.
- retry and DLQ integration.

### EventBridge

- Event fan-out and routing.
- Scheduled triggers.
- AWS service events.
- Decoupled domain integration events.

### Outbox

- Prevent domain/database dual-write loss.

## Consequences

- Robust failure isolation.
- Additional operational tables and replay tools.
- Eventual consistency must be represented in UX and tests.
- Duplicate handling is mandatory, not optional.
## EventBridge Scheduler Clarification

Use EventBridge Scheduler for durable one-time and recurring schedules. Do not use in-process timers for business-critical reminders, subscription actions or maintenance.

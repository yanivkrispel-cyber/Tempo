# ADR-0008: SQS, EventBridge and Transactional Outbox for Asynchronous Work

- **Status:** Accepted, amended on 2026-10-13 (one work queue and an outbox sweeper)
- **Date:** 2026-07-30
- **Owners:** Architecture, Backend Engineering, Platform Engineering
- **Related:** ADR-0002, ADR-0003, ADR-0005, ADR-0021

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

## Amendment 2026-10-13: One Work Queue and an Outbox Sweeper

ADR-0021 removes fixed and idle costs. A queue costs nothing at rest, but every Lambda SQS trigger keeps long-polling, even when the queue is empty. Those empty receives count toward SQS's 1 million free requests a month. The design therefore keeps the number of queues and triggers small.

- **One SQS Standard work queue and one DLQ per environment.** Each message carries a type, and the worker dispatches by type with partial batch responses. A separate queue is added only when a provider or job needs its own backpressure or concurrency limit, and the reason is recorded.
- **Outbox dispatch.**
  - Right after a transaction commits, the API sends that transaction's outbox rows to the queue.
  - EventBridge Scheduler runs a sweeper every minute. It sends any rows that were not dispatched, for example because the process stopped between commit and send.
  - Scheduler includes 14 million invocations a month at no cost.
- **EventBridge bus.** It is used only when an event really fans out to several independent consumers. A single consumer reads from the queue.
- **Reminders and recurring work.** These use EventBridge Scheduler, as this ADR already requires.
- **Monitoring.** The same Scheduler runs a canary every five minutes (ADR-0012).

Delivery semantics do not change: at least once, idempotent consumers, and bounded retries into the DLQ.

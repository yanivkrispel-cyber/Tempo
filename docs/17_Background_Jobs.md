# Background Jobs

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Categories

One-time, delayed, recurring, import/export, synchronization, reconciliation, retention and projection.

## 2. Contract

```json
{
  "jobId": "uuid",
  "jobType": "communications.send-notification",
  "version": 1,
  "organizationId": "uuid",
  "scheduledFor": "timestamp",
  "attempt": 0,
  "correlationId": "string",
  "payload": {}
}
```

## 3. Reliability

At-least-once, idempotency, leases, bounded backoff, max attempts, dead letter, cancellation, heartbeat and checkpoints.

## 4. Concurrency

Per job type: global limit, tenant limit, partition key, uniqueness key and lease duration.

## 5. Batch Processing

Bounded pages, checkpoint cursor, page commits, progress, pause/cancel and provider throttle.

## 6. Scheduler

Scheduler enqueues durable work and defines timezone plus misfire policy.

## 7. Operations

Search, inspect, replay, cancel, progress, queue depth and age.

## 8. Initial Jobs

Outbox, webhooks, notification delivery/status, file scan/cleanup, entitlements, billing reconciliation, integration sync and retention.

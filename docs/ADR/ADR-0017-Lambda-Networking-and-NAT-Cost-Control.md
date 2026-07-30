# ADR-0017: Lambda Networking and NAT Cost Control

- **Status:** Proposed
- **Date:** 2026-07-30
- **Owners:** Architecture, Platform Engineering, Security
- **Related:** ADR-0002, ADR-0005, ADR-0008, ADR-0013, ADR-0015

## Context

Lambda functions run with public internet connectivity by default. Attaching a function to a customer VPC is required for direct private connectivity to Aurora, but then outbound traffic follows VPC routing. Internet access from private subnets normally requires a NAT gateway, which introduces fixed hourly and data-processing cost.

Tempo must balance database privacy, external provider connectivity, operational simplicity and early-stage cost.

## Proposed Decision

Use two execution classes:

1. **Database-connected functions** run in private subnets across at least two Availability Zones and access Aurora through security-group-restricted private networking.
2. **Internet/provider adapter functions** remain outside the VPC whenever they do not require direct database access. They exchange durable commands and results through SQS/EventBridge.

Avoid a NAT gateway in development by default. For production, choose between a single NAT gateway and a NAT-less split-worker topology after an implementation cost and failure-mode spike.

## Required Spike Before Acceptance

Prototype and compare:

### Option A - One NAT Gateway in Production

- Simpler direct provider calls from database-connected functions.
- Higher fixed cost and single-AZ egress dependency unless duplicated.

### Option B - NAT-less Split Workers

- Database workers in private subnets.
- External provider workers outside VPC.
- SQS/EventBridge carries normalized commands and results.
- Lower fixed network cost but more eventual-consistency and orchestration complexity.

### Option C - Aurora Data API

Evaluate only as a targeted alternative. The Data API has response-size and writer-only query limitations and may not fit ORM/query patterns.

## VPC Endpoint Policy

Create endpoints only when their monthly cost is justified by traffic, security or NAT avoidance. S3 gateway endpoints are preferred where applicable. Interface endpoint policies must be least privilege.

## Guardrails

- Public subnets do not make ordinary VPC-attached Lambda functions internet accessible.
- Aurora is never publicly accessible.
- Security groups reference security groups, not broad CIDRs, where possible.
- Database-connected Lambda concurrency is bounded.
- External calls use timeout, circuit breaker and idempotency.

## Acceptance Criteria

This ADR becomes Accepted only after the spike documents monthly cost, latency, failure modes, deployment complexity and local-development impact for the first production traffic estimate.

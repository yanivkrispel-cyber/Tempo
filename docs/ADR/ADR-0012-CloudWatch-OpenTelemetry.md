# ADR-0012: CloudWatch-Centered Observability with OpenTelemetry

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Platform Engineering, SRE, Architecture
- **Related:** ADR-0001, ADR-0002, ADR-0008

## Context

Tempo needs one operational view for APIs, Lambda functions, queues, database health, external providers and business-critical jobs. Early-stage simplicity favors AWS-native observability.

## Decision

Use:

- Amazon CloudWatch Logs for structured logs.
- CloudWatch Metrics and Alarms.
- CloudWatch dashboards.
- AWS X-Ray and/or OpenTelemetry instrumentation for traces.
- Embedded Metric Format or OpenTelemetry metrics where useful.
- CloudWatch Synthetics for selected production journeys when justified.

## Telemetry Standards

Every request/event/job includes:

- Correlation ID.
- Trace ID.
- Environment.
- Module/function.
- Operation or event type.
- Result code.
- Duration.
- Organization ID only where permitted and non-sensitive.
- External provider name and normalized result.

## Logging Rules

Do not log passwords, tokens, secrets, raw payment data, unrestricted message contents or sensitive documents.

Logs are structured JSON and have retention policies by environment/data category.

## Required Alarms

- API error and latency.
- Lambda throttles/errors/duration.
- Queue age and DLQ depth.
- Outbox publication lag.
- Aurora connections, capacity and errors.
- Webhook processing lag.
- Notification delivery failures.
- File scan failures.
- Billing reconciliation mismatch.
- WAF/security signals.

## Consequences

- Low integration overhead.
- CloudWatch costs must be controlled through retention and metric discipline.
- OpenTelemetry preserves a future path to another backend if required.

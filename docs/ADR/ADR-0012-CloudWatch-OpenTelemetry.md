# ADR-0012: CloudWatch-Centered Observability with OpenTelemetry

- **Status:** Accepted, amended on 2026-10-13 (an alarm budget, sampling and a canary)
- **Date:** 2026-07-30
- **Owners:** Platform Engineering, SRE, Architecture
- **Related:** ADR-0001, ADR-0002, ADR-0008, ADR-0021

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
## Cost Controls

- Explicit retention per log group; no indefinite retention by default.
- High-cardinality business identifiers must not become metric dimensions.
- Sampling is configurable for traces.
- Debug logging is disabled in production unless temporarily approved.

## Amendment 2026-10-13: Alarm Budget, Sampling and a Canary

CloudWatch's ten free alarms are pooled across the whole AWS Organization, and every alarm beyond them costs $0.10 a month. ADR-0021 therefore sets an alarm budget:

- **Development has no alarms.** Its failures surface in CI, in the smoke test and in the canary log.
- **Production has at most ten alarms:**
  1. CloudFront 5xx rate
  2. Lambda Errors across all functions
  3. Lambda Throttles across all functions
  4. API p99 duration
  5. DLQ messages visible
  6. Age of the oldest message in the work queue
  7. A DSQL DPU spike
  8. SES bounce rate
  9. SES complaint rate
  10. Canary failure

  Lambda publishes Errors and Throttles at the account level ("across all functions"), so one alarm covers every function.
- **Canary.** EventBridge Scheduler invokes it every five minutes. It calls the API's health endpoint through CloudFront and writes the result to the log. It also keeps one API instance warm.
- **Tracing.** X-Ray sampling is a fixed 5% with no reservoir. A reservoir would trace almost every request at low traffic, and only the first 100,000 traces a month are free.
- **Free Tier dashboard.** One CloudWatch dashboard shows usage against each free allowance:
  - Lambda, SQS, Cognito MAU, DSQL DPU and storage, CloudFront requests and log ingestion;
  - next to the ADR-0021 tripwires.

The list of required alarms above stays as the list of signals to watch. Any of them that is not one of the ten alarms is watched on the dashboard, not alarmed.

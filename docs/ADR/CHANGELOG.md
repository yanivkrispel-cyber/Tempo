# ADR Baseline v3.1 - Change Log (2026-10-13)

The owners accepted the council proposal "Tempo Zero" on 2026-10-13. These are the parts that do not depend on the database choice. The database decision, ADR-0022 with the Aurora DSQL spike results, comes in a separate change.

## Added ADRs

- ADR-0021: zero fixed cost until revenue, with tripwires that need owner approval (including hourly backups at 10 active studios).

## Amended ADRs

- ADR-0004: CloudFront plus a Lambda Function URL behind Origin Access Control replaces API Gateway. JWT validation moves into the API.
- ADR-0008: one SQS work queue and one DLQ, an outbox sweeper on EventBridge Scheduler, and an EventBridge bus only for real fan-out.
- ADR-0009: WAF in every environment through the CloudFront flat-rate Free plan.
- ADR-0012: ten production alarms and none in development, 5% trace sampling, a canary and a Free Tier dashboard.
- ADR-0020: a $1 budget that alerts on the first cent, and Cost Anomaly Detection at $1.

# ADR Baseline v3.0 - Change Log

## Updated Existing ADRs

- ADR-0001: clarified backup direction and IaC/emergency-change rules.
- ADR-0002: fixed backend runtime to .NET 10 and linked networking decision.
- ADR-0004: clarified Cognito access-token validation, CORS preflight and application authorization.
- ADR-0005: added engine-version caveat for 0 ACU, restore testing and RDS cost comparison gate.
- ADR-0007: selected Cognito Essentials and initial managed-login direction.
- ADR-0008: selected EventBridge Scheduler for durable schedules.
- ADR-0009: limited WAF default use to production to control early cost.
- ADR-0012: added observability cost controls.
- ADR-0014: documented CloudFront certificate region and price/service review.

## Added ADRs

- ADR-0016: .NET 10 managed runtime.
- ADR-0017: Lambda networking and NAT cost spike (Proposed).
- ADR-0018: Amazon SES transactional email.
- ADR-0019: backup and recovery.
- ADR-0020: AWS cost governance.

## Important Open Item

ADR-0017 is intentionally Proposed. Networking must be validated before production because direct Aurora access places Lambda in a VPC, while public-provider access can introduce NAT gateway or VPC endpoint cost.

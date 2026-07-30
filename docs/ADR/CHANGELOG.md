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

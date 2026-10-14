# ADR Baseline v3.4 - Change Log (2026-10-14)

The owner approved the frontend toolchain for the web apps (night board #44, decision 1).

## Added ADRs

- ADR-0024: Vite, React 19, React Router 7, TanStack Query, `openapi-typescript` + `openapi-fetch`, Vitest +
  Testing Library for all web apps. Approved by Kris on 2026-10-14. $0.

# ADR Baseline v3.3 - Change Log (2026-10-14)

The product owner decided the two questions that blocked the Phase 1 design: onboarding (D7) and operator MFA (D8).

## Added ADRs

- ADR-0023: studio owners sign up on their own; staff and clients join by invitation or join link; the Tempo team signs in through a separate user pool with MFA required.

## Amended ADRs

- ADR-0007: two user pools instead of one; self sign-up stays on for the customer pool.

# ADR Baseline v3.2 - Change Log (2026-10-14)

Aurora DSQL could not be created for the account (support case open since 2026-10-13). The owners chose Neon serverless Postgres as the database for good.

## Added ADRs

- ADR-0022: Neon serverless Postgres in Frankfurt, one project per environment, Free plan until the pilot, no VPC, credentials in SSM Parameter Store.

## Superseded or Closed ADRs

- ADR-0005: Aurora Serverless v2 is replaced by ADR-0022.
- ADR-0017: no VPC, so the NAT question is closed.

## Amended ADRs

- ADR-0001: the database is the one non-AWS vendor.
- ADR-0006: structural isolation stays primary; RLS is added as a second layer, set per transaction.
- ADR-0013: Neon's pooler replaces RDS Proxy.
- ADR-0015: database credentials in SSM SecureString instead of Secrets Manager.
- ADR-0019: a 6-hour restore window until the pilot, accepted by the owners; the pre-pilot backup choice is recorded.
- ADR-0021: Neon tripwires replace the DSQL ones.

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

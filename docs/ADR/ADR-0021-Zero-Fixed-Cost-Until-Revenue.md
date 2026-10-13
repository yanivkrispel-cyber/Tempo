# ADR-0021: Zero Fixed Cost Until Revenue

- **Status:** Accepted
- **Date:** 2026-10-13
- **Owners:** Founders, Platform Engineering
- **Related:** ADR-0004, ADR-0005, ADR-0008, ADR-0009, ADR-0012, ADR-0014, ADR-0017, ADR-0019, ADR-0020; the database decision follows the Aurora DSQL spike (planned ADR-0022)

## Context

Tempo runs in a personal AWS Organization whose management account was created in 2015. It has no 12-month Free Tier and no new-account credits. Only the Always Free offers apply, and they are pooled across the Organization. Every hourly or monthly charge is billed from the first day.

The owners decided on 2026-10-10 that Tempo carries no payment cost until it has revenue. They confirmed the definition on 2026-10-13 (council decision Q1):

- Fixed cost is $0.
- Variable cost may reach about $5 per month at 50 studios.

The baseline design does not meet that target. These figures were verified with the AWS Price List API for `eu-central-1` on 2026-10-10:

- **Production floor before the first studio:** $64.73 per month.
  - Aurora with at least 0.5 ACU and no auto-pause, per ADR-0005.
  - WAF.
  - Five secrets.
  - 28 alarms.
  - A hosted zone.
- **With a NAT gateway (ADR-0017):** $106.34 per month.
- **The development environment as coded on `feature/aws-foundation`:** about $20 per month. Most of that is $17.52 for one interface endpoint, which exists only for the migrator.

## Decision

1. No resource with a fixed hourly or monthly charge is created in any environment unless one of the tripwires below has fired and the owners approve it. Typical examples:
   - NAT gateway or Elastic IP.
   - Interface VPC endpoint.
   - Provisioned or minimum-capacity database.
   - Secrets Manager secret.
   - WAF web ACL outside the CloudFront flat-rate Free plan.
   - Customer-managed KMS key.
   - Alarms beyond the ten that are free.
   - Provisioned concurrency.
   - Any always-on compute.
2. Usage-based cost is allowed. At 50 studios, with the default assumptions (200 members per studio, 75% active), it must stay at or below about $5 per month.
3. Every account has a $1 AWS Budget (status page decision D2). It alerts on the first $0.01 of actual spend and on a forecast above $1. Cost Anomaly Detection alerts at $1.
4. Every pull request that adds or changes an AWS resource states that resource's fixed monthly cost and variable unit cost. This extends the review requirement in ADR-0020.
5. Any change in architecture or price that crosses a tripwire comes back to the owners as a decision. It is never done silently.

## Tripwires

A tripwire is the point at which Tempo starts paying for something. The "when" column uses the default model assumptions. Each row needs owner approval at the time it fires.

| Trigger | Approximately when | What is paid for | Cost |
|---|---|---|---|
| Domain needed | Before the pilot (council Q8) | Domain registration. The hosted zone is covered by the CloudFront Free plan | About $10–15 per year |
| First paying studio | Pilot | GuardDuty in production | About $1–3 per month (estimate) |
| Sensitive data, such as health declarations | When the feature is built | One customer-managed KMS key for field-level encryption | $1 per month |
| **10 active studios** | Growth | **The owners are alerted, and backups move from daily to hourly** (owner instruction on council Q5) | About $2–4 per month |
| DSQL storage passes 1 GB (if the spike confirms DSQL) | About 60 studios, after a year | Storage | $0.45 per GB-month |
| Cognito passes 10,000 MAU | About 65 studios | Essentials MAU | $0.015 per MAU |
| CloudFront passes 1M requests per month, sustained | About 75 studios | Pro plan, or a second distribution | $15 per month, or $0 with a split |
| DSQL passes 100,000 DPU per month (if the spike confirms DSQL) | About 80 studios | DPU | $9.50 per million DPU |
| WhatsApp or SMS requested by a studio | On request (council Q7) | Per message, passed through to that studio | Provider price |
| A contract requires RPO under 24 hours | Large customer | Hourly AWS Backup | About $2–4 per month |
| RLS, extensions or PITR become mandatory | Regulated vertical | Aurora PostgreSQL | From about $51 per month |

The 10-studio tripwire is the only one that needs a mechanism before it can fire. A daily EventBridge Scheduler job counts active organizations. When the count reaches 10, it notifies the owners by email through SNS, which is free up to 1,000 emails per month. The job is built together with the Organization module.

## Enforcement

- A CDK unit test fails when a synthesized template contains a fixed-cost resource type that is not on an explicit, reviewed allowlist. Examples:
  - `AWS::EC2::NatGateway`, `AWS::EC2::EIP`, or an interface `AWS::EC2::VPCEndpoint`.
  - `AWS::RDS::DBCluster` or `AWS::SecretsManager::Secret`.
  - `AWS::WAFv2::WebACL` outside the Free plan, or a customer-managed `AWS::KMS::Key`.
- Each environment has an alarm count budget: zero alarms in development, and at most ten in production. The ten free alarms are pooled across the whole AWS Organization, so every alarm in development is taken from production's free allowance.
- The monthly cost review from ADR-0020 also checks the Free Tier usage dashboard against the tripwires.

## Consequences

- Production does not need idle capacity. Tempo can run pilots without a monthly bill.
- Some convenience features of the baseline are replaced by cheaper patterns:
  - The database is planned as Aurora DSQL instead of Aurora Serverless v2. A spike decides it, and the planned ADR-0022 records the result.
  - If DSQL is confirmed, there is no VPC, and ADR-0017 closes with that ADR.
  - CloudFront Function URLs replace API Gateway.
  - One work queue replaces one queue per job type.
  Each of these replacements has a recorded exit path.
- Every tripwire is visible in advance, with its price, so paying becomes a planned decision and not a surprise.
- More engineering judgment is needed on each change. Cost review is part of code review.

# ADR-0014: AWS Account, Region and Environment Strategy

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Platform Engineering, Security, Finance
- **Related:** ADR-0001, ADR-0010, ADR-0011

## Context

Environment isolation is a security and robustness boundary. Hosting all workloads in one AWS account increases blast radius, IAM complexity and cost attribution risk.

## Decision

Use AWS Organizations with separate AWS accounts for major environments.

Recommended initial accounts:

- Management / billing account.
- Shared security and logging account when operationally ready.
- Development account.
- Staging account.
- Production account.

For a very small initial team, development and staging may temporarily share a non-production account, but production must remain separate.

## Primary Region

Use `eu-central-1` as the initial primary application region, subject to final legal/data-residency review, current service availability and price review. CloudFront certificates are provisioned in `us-east-1` where AWS requires it.

## Region Rules

- Single-region production initially.
- Multi-AZ managed services within the region.
- Backups protected according to recovery requirements.
- Cross-region disaster recovery is deferred until RPO/RTO and commercial requirements justify cost.
- Service availability must be confirmed in the primary region before adoption.

## IAM Rules

- Human AWS access through IAM Identity Center.
- No shared users.
- MFA required.
- Workloads use IAM roles.
- CI/CD assumes environment-specific deployment roles.
- Break-glass access is separate, monitored and tested.

## Cost Governance

- Mandatory tags: environment, system, module, owner, cost-center, data-classification.
- AWS Budgets and cost anomaly detection.
- Service quotas reviewed.
- Non-production shutdown/auto-pause policies.
- Monthly architecture cost review.

## Consequences

- Stronger isolation and clearer cost ownership.
- More account/bootstrap setup.
- Cross-account deployment and centralized logging require planned IAM.

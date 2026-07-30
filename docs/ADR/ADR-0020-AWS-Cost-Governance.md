# ADR-0020: AWS Cost Governance from the First Environment

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Founders, Platform Engineering, Finance
- **Related:** ADR-0001, ADR-0002, ADR-0005, ADR-0012, ADR-0014

## Context

Serverless and managed services reduce operations but do not eliminate cost risk. Logging, NAT gateways, interface endpoints, database minimum capacity, WAF, data transfer and accidental non-production resources can create recurring spend before revenue.

## Decision

Cost is a first-class architecture quality attribute. Every environment and major feature must include an estimated and measured cost model.

## Mandatory Controls

- AWS Budgets per account/environment.
- Cost Anomaly Detection.
- Mandatory resource tags.
- Short CloudWatch retention in non-production unless needed.
- Aurora auto-pause/low maximum capacity in non-production where supported.
- No NAT gateway, Redis, OpenSearch, Kafka, EKS or provisioned concurrency without an accepted ADR or explicit cost approval.
- Automated cleanup for preview/ephemeral resources.
- Monthly top-service and top-tag cost review.
- Alerts for unexpected data transfer, log ingestion, queue backlog and database capacity.

## Architecture Review Requirement

Every new managed service proposal documents:

- Fixed monthly cost.
- Variable unit cost.
- expected pilot usage.
- expected 10x usage.
- operational savings.
- exit/removal plan.

## Cost Allocation

Tag dimensions include environment, system, module, owner, cost center and data classification. Tenant-level cost attribution is implemented for variable-cost services such as messaging, files and compute where commercially useful.

## Consequences

- Some convenience services will be deferred until measured need exists.
- Cost reviews become part of engineering operations.
- Architecture decisions can be revisited using evidence rather than assumptions.

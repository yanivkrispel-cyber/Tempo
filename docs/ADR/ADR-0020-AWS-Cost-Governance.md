# ADR-0020: AWS Cost Governance from the First Environment

- **Status:** Accepted, amended on 2026-10-13 (the zero fixed cost policy and a $1 budget)
- **Date:** 2026-07-30
- **Owners:** Founders, Platform Engineering, Finance
- **Related:** ADR-0001, ADR-0002, ADR-0005, ADR-0012, ADR-0014, ADR-0021

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

## Amendment 2026-10-13: Zero Fixed Cost and a $1 Budget

ADR-0021 adds a numeric target to this ADR's controls: a fixed cost of $0 until there is revenue, with tripwires that the owners approve.

- **The Organization-wide budget.** `tempo-org-zero-cost` lives in the management account and covers every account. It is $1 a month. It alerts on the first $0.01 of actual spend and on a forecast above $1. It was created on 2026-10-13.
- **Per-account budgets.** Each account's budget in the AccountBaseline stack is $1, not $200, with the same two alerts.
- **Cost Anomaly Detection.** The threshold is $1, not $50.
- **Review requirement.** Every new managed service, and every pull request that adds an AWS resource, states the fixed monthly cost and the variable unit cost. A non-zero fixed cost needs a tripwire in ADR-0021.

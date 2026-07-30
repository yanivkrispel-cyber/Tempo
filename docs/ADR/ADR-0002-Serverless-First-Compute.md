# ADR-0002: Serverless-First Compute with AWS Lambda

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Backend Engineering
- **Related:** ADR-0003, ADR-0004, ADR-0008

## Context

Tempo expects low and uneven traffic during development, pilots and early commercial operation. A permanently running container platform would introduce baseline cost and operational work. EKS would add cluster management that is not justified.

AWS Lambda scales execution environments in response to requests and supports concurrency controls for protecting downstream resources.

## Decision

Use AWS Lambda as the default compute runtime for:

- Synchronous API requests.
- SQS consumers.
- EventBridge event handlers.
- Webhook processing.
- File-processing steps.
- Imports, exports and reconciliation that fit Lambda execution limits.
- Scheduled maintenance jobs.

The backend remains a modular monolith at the code and domain level. Deployment may package the API as one or a small number of Lambda functions based on startup time, security and operational boundaries.

## Runtime Rules

- Use the current supported .NET LTS runtime selected by the implementation ADR.
- Functions are stateless.
- Reuse SDK and database connections across warm invocations safely.
- Apply reserved concurrency to database-connected workloads.
- Use provisioned concurrency only after measured latency justifies the cost.
- All I/O supports cancellation and timeout.
- Long-running jobs checkpoint and split into bounded work.
- Functions that do not require VPC resources remain outside the VPC.

## Alternatives Considered

### Amazon ECS on Fargate

Rejected initially because it introduces continuously allocated compute and additional service/load-balancer operations. It remains the preferred extraction path for sustained workloads or long-running processes.

### Amazon EKS

Rejected because Kubernetes operational complexity is disproportionate to the current team and product stage.

### EC2

Rejected because server patching, scaling, capacity planning and recovery provide no current advantage.

## Consequences

### Positive

- Low idle compute cost.
- Automatic scaling.
- Minimal host maintenance.
- Native integration with API Gateway, SQS, EventBridge and S3.
- Clear event-driven execution model.

### Negative

- Cold starts.
- Execution duration and payload limits.
- Database connection pressure if concurrency is uncontrolled.
- Some workloads may later be cheaper on containers.

## Extraction Criteria to ECS Fargate

Move a workload when one or more apply:

- It regularly approaches Lambda duration limits.
- It requires stable long-lived connections.
- Traffic is sustained enough that containers are measurably cheaper.
- Runtime or memory requirements do not fit Lambda.
- Provisioned concurrency becomes a material recurring cost.
- A dedicated failure/security boundary is required.

## Review Trigger

Quarterly cost and performance review, or when a workload meets an extraction criterion.

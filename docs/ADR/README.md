# Tempo Architecture Decision Records - Current Baseline

- **Version:** 3.1
- **Date:** 2026-10-13
- **Cloud Decision:** AWS exclusive
- **Architecture Direction:** Serverless-first modular monolith
- **Backend Runtime:** .NET 10
- **Primary Region:** eu-central-1

## Status Definitions

- **Proposed** - under review or requires an implementation spike.
- **Accepted** - mandatory baseline.
- **Superseded** - replaced by a newer ADR.
- **Rejected** - considered but not selected.
- **Deprecated** - retained for history but no longer recommended.

## Current ADR Catalog

| ADR | Decision | Status |
|---|---|---|
| ADR-0001 | AWS as the Exclusive Cloud Platform | Accepted |
| ADR-0002 | Serverless-First Compute with AWS Lambda | Accepted |
| ADR-0003 | Modular Monolith with Event-Driven Boundaries | Accepted |
| ADR-0004 | Amazon API Gateway HTTP API for Public APIs | Accepted, amended 2026-10-13: CloudFront + Function URL |
| ADR-0005 | Aurora PostgreSQL Serverless v2 as the Primary Transactional Database | Accepted |
| ADR-0006 | Shared-Schema Multi-Tenancy with Defense in Depth | Accepted |
| ADR-0007 | Amazon Cognito for Authentication Behind an Internal Identity Boundary | Accepted |
| ADR-0008 | SQS, EventBridge and Transactional Outbox for Asynchronous Work | Accepted, amended 2026-10-13: one work queue |
| ADR-0009 | S3, CloudFront, WAF and Route 53 for Web Delivery | Accepted, amended 2026-10-13: WAF in every environment |
| ADR-0010 | AWS CDK in TypeScript for Infrastructure as Code | Accepted |
| ADR-0011 | GitHub Actions with AWS OIDC for CI/CD | Accepted |
| ADR-0012 | CloudWatch-Centered Observability with OpenTelemetry | Accepted, amended 2026-10-13: alarm budget |
| ADR-0013 | Do Not Introduce Redis or RDS Proxy Initially | Accepted |
| ADR-0014 | AWS Account, Region and Environment Strategy | Accepted |
| ADR-0015 | S3, Secrets Manager and KMS for Storage Security | Accepted |
| ADR-0016 | .NET 10 Managed Runtime for AWS Lambda | Accepted |
| ADR-0017 | Lambda Networking and NAT Cost Control | Proposed |
| ADR-0018 | Amazon SES for Transactional Email | Accepted |
| ADR-0019 | Backup, Recovery and Data Protection Strategy | Accepted |
| ADR-0020 | AWS Cost Governance from the First Environment | Accepted, amended 2026-10-13: $1 budget |
| ADR-0021 | Zero Fixed Cost Until Revenue | Accepted |

## Decision Summary

```text
Cloud: AWS
Frontend: Private S3 + CloudFront (flat-rate Free plan) + Route 53; WAF in every environment
API: Lambda Function URL behind the same CloudFront distribution (OAC)
Compute: AWS Lambda
Backend runtime: .NET 10 managed runtime
Application: Modular Monolith
Database: Aurora PostgreSQL Serverless v2
Identity: Cognito User Pools Essentials
Async: one SQS work queue + DLQ, EventBridge Scheduler (outbox sweeper, reminders, canary), Transactional Outbox; EventBridge bus only for fan-out
Files: S3
Secrets: Secrets Manager; Parameter Store for non-secrets
Encryption: KMS
Email: SES
Observability: CloudWatch + OpenTelemetry/X-Ray
Cost: $0 fixed cost until revenue; tripwires need owner approval (ADR-0021)
IaC: AWS CDK TypeScript
CI/CD: GitHub Actions + OIDC
Primary Region: eu-central-1
Cache/DB proxy: None initially
Networking: ADR-0017 remains Proposed pending cost spike
```

## Precedence

If an architecture specification conflicts with an Accepted ADR, the ADR takes precedence. Update the specification in the same change set whenever practical.

## Implementation Verification

AWS features, runtime support, regional availability, quotas and prices must be revalidated before provisioning production and during quarterly architecture reviews.

# Tempo Architecture Decision Records — Current Baseline

- **Version:** 2.0
- **Date:** 2026-07-30
- **Cloud Decision:** AWS exclusive
- **Architecture Direction:** Serverless-first modular monolith

## ADR Statuses

- **Proposed** — under review.
- **Accepted** — mandatory baseline.
- **Superseded** — replaced by a newer ADR.
- **Rejected** — considered but not selected.
- **Deprecated** — no longer recommended, retained for history.

## Current ADR Catalog

| ADR | Decision |
|---|---|
| ADR-0001 | AWS as exclusive cloud platform |
| ADR-0002 | Serverless-first compute with Lambda |
| ADR-0003 | Modular monolith |
| ADR-0004 | API Gateway HTTP API |
| ADR-0005 | Aurora PostgreSQL Serverless v2 |
| ADR-0006 | Shared-schema multi-tenancy |
| ADR-0007 | Cognito behind internal identity boundary |
| ADR-0008 | SQS + EventBridge + transactional outbox |
| ADR-0009 | S3 + CloudFront + WAF + Route 53 |
| ADR-0010 | AWS CDK in TypeScript |
| ADR-0011 | GitHub Actions with AWS OIDC |
| ADR-0012 | CloudWatch + OpenTelemetry/X-Ray |
| ADR-0013 | No Redis or RDS Proxy initially |
| ADR-0014 | AWS account, region and environment strategy |
| ADR-0015 | S3, Secrets Manager and KMS |

## Decision Summary

```text
Cloud: AWS
Frontend: S3 + CloudFront + WAF + Route 53
API: API Gateway HTTP API
Compute: Lambda
Application: Modular Monolith
Database: Aurora PostgreSQL Serverless v2
Identity: Cognito
Async: SQS + EventBridge + Transactional Outbox
Files: S3
Secrets: Secrets Manager
Encryption: KMS
Email: SES
Observability: CloudWatch + OpenTelemetry/X-Ray
IaC: AWS CDK TypeScript
CI/CD: GitHub Actions + OIDC
Primary Region: eu-central-1
```

## References

The decisions are based on official AWS documentation for Lambda concurrency and scaling, API Gateway HTTP APIs, Aurora Serverless v2 auto-pause, and Amazon Cognito user pools. Service versions, limits and prices must be revalidated during implementation and cost reviews.

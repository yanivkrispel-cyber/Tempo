# Tempo Architecture Decision Records - Current Baseline

- **Version:** 3.6
- **Date:** 2026-10-17
- **Cloud Decision:** AWS, except the database (Neon on AWS eu-central-1, ADR-0022) and the dev web apps (Cloudflare Pages, ADR-0027)
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
| ADR-0001 | AWS as the Exclusive Cloud Platform | Accepted, amended 2026-10-14 and 2026-10-17: Neon and Cloudflare Pages are the exceptions |
| ADR-0002 | Serverless-First Compute with AWS Lambda | Accepted |
| ADR-0003 | Modular Monolith with Event-Driven Boundaries | Accepted |
| ADR-0004 | Amazon API Gateway HTTP API for Public APIs | Accepted, amended 2026-10-13: CloudFront + Function URL |
| ADR-0005 | Aurora PostgreSQL Serverless v2 as the Primary Transactional Database | Superseded by ADR-0022 |
| ADR-0006 | Shared-Schema Multi-Tenancy with Defense in Depth | Accepted, amended 2026-10-14: structural isolation plus RLS |
| ADR-0007 | Amazon Cognito for Authentication Behind an Internal Identity Boundary | Accepted, amended 2026-10-14: two user pools (ADR-0023) |
| ADR-0008 | SQS, EventBridge and Transactional Outbox for Asynchronous Work | Accepted, amended 2026-10-13: one work queue |
| ADR-0009 | S3, CloudFront, WAF and Route 53 for Web Delivery | Accepted, amended 2026-10-13: WAF in every environment; dev on Cloudflare Pages (ADR-0027) |
| ADR-0010 | AWS CDK in TypeScript for Infrastructure as Code | Accepted |
| ADR-0011 | GitHub Actions with AWS OIDC for CI/CD | Accepted |
| ADR-0012 | CloudWatch-Centered Observability with OpenTelemetry | Accepted, amended 2026-10-13: alarm budget |
| ADR-0013 | Do Not Introduce Redis or RDS Proxy Initially | Accepted, amended 2026-10-14: Neon's pooler |
| ADR-0014 | AWS Account, Region and Environment Strategy | Accepted |
| ADR-0015 | S3, Secrets Manager and KMS for Storage Security | Accepted, amended 2026-10-14: DB credentials in SSM |
| ADR-0016 | .NET 10 Managed Runtime for AWS Lambda | Accepted |
| ADR-0017 | Lambda Networking and NAT Cost Control | Superseded by ADR-0022: no VPC |
| ADR-0018 | Amazon SES for Transactional Email | Accepted |
| ADR-0019 | Backup, Recovery and Data Protection Strategy | Accepted, amended 2026-10-14: Neon restore window |
| ADR-0020 | AWS Cost Governance from the First Environment | Accepted, amended 2026-10-13: $1 budget |
| ADR-0021 | Zero Fixed Cost Until Revenue | Accepted, amended 2026-10-14: Neon tripwires |
| ADR-0022 | Neon Serverless Postgres as the Primary Transactional Database | Accepted |
| ADR-0023 | Studio Self-Onboarding and a Separate Operator Identity Pool | Accepted |
| ADR-0024 | Frontend Toolchain for the Tempo Web Apps | Accepted |
| ADR-0025 | Two-Layer Quality: Gates Block, Agents Advise | Proposed |
| ADR-0026 | Field-Level Encryption Without a Customer-Managed Key Until Revenue | Accepted |
| ADR-0027 | Web Apps on Cloudflare Pages While CloudFront Is Refused | Accepted |
| ADR-0028 | The Members' Sign-In Is Our Own Screen Over Cognito's API | Accepted |

## Decision Summary

```text
Cloud: AWS
Frontend: Private S3 + CloudFront (flat-rate Free plan) + Route 53; WAF in every environment
API: Lambda Function URL behind the same CloudFront distribution (OAC)
Compute: AWS Lambda
Backend runtime: .NET 10 managed runtime
Application: Modular Monolith
Database: Neon serverless Postgres 18 (eu-central-1), pooled endpoint for API/Worker
Identity: Cognito User Pools Essentials: one pool for studios and clients, one MFA-only pool for operators (ADR-0023)
Async: one SQS work queue + DLQ, EventBridge Scheduler (outbox sweeper, reminders, canary), Transactional Outbox; EventBridge bus only for fan-out
Files: S3
Secrets: SSM Parameter Store SecureString (no Secrets Manager until a tripwire)
Encryption: KMS; health fields AES-GCM in the app with the key in an SSM SecureString under aws/ssm (ADR-0026)
Email: SES
Observability: CloudWatch + OpenTelemetry/X-Ray
Cost: $0 fixed cost until revenue; tripwires need owner approval (ADR-0021)
Web apps: Vite + React 19 + React Router 7 + TanStack Query; API client from OpenAPI (ADR-0024)
Quality: deterministic CI gates block; Claude review agents run locally and advise (ADR-0025)
IaC: AWS CDK TypeScript
CI/CD: GitHub Actions + OIDC
Primary Region: eu-central-1
Cache/DB proxy: None; Neon's built-in pooler
Networking: no VPC (ADR-0017 closed by ADR-0022)
```

## Precedence

If an architecture specification conflicts with an Accepted ADR, the ADR takes precedence. Update the specification in the same change set whenever practical.

## Implementation Verification

AWS features, runtime support, regional availability, quotas and prices must be revalidated before provisioning production and during quarterly architecture reviews.

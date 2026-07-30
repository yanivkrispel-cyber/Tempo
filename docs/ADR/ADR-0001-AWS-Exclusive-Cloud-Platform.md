# ADR-0001: AWS as the Exclusive Cloud Platform

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Founders, Architecture, Platform Engineering
- **Decision Scope:** Organization-wide
- **Supersedes:** Any cloud-neutral or multi-cloud hosting assumptions in earlier drafts

## Context

Tempo requires a platform that is inexpensive at low usage, scalable without infrastructure redesign, simple for a small engineering team to operate, and robust enough for commercial workloads.

Supporting multiple cloud providers would increase infrastructure code, security controls, observability systems, operational knowledge, deployment paths and disaster-recovery complexity before a business requirement exists.

## Decision

AWS is the exclusive hosting platform for Tempo production workloads and managed platform data.

The following must be hosted in AWS:

- Application compute.
- API edge and routing.
- Primary transactional databases.
- Queues and event routing.
- Object storage.
- Secrets and encryption keys.
- Logs, metrics, traces and alarms.
- Backups and recovery artifacts.
- Frontend hosting and CDN.
- DNS and certificates.
- Infrastructure state and deployment roles.

External SaaS providers are permitted only as business integrations or specialized tooling, for example payment processors, WhatsApp providers or source-control services. They must not become an unreviewed replacement for core AWS hosting.

## Approved AWS Service Direction

| Capability | AWS Service Direction |
|---|---|
| Frontend | Amazon S3 + Amazon CloudFront |
| Edge security | AWS WAF |
| DNS | Amazon Route 53 |
| API | Amazon API Gateway HTTP API |
| Compute | AWS Lambda |
| Database | Amazon Aurora PostgreSQL Serverless v2 |
| Queue | Amazon SQS |
| Event routing/scheduling | Amazon EventBridge |
| Identity | Amazon Cognito |
| Files | Amazon S3 |
| Secrets | AWS Secrets Manager |
| Encryption | AWS KMS |
| Email | Amazon SES |
| Observability | Amazon CloudWatch + AWS X-Ray/OpenTelemetry |
| Infrastructure as Code | AWS CDK |
| Backup | AWS Backup and service-native backups |

## Consequences

### Positive

- One security and operational model.
- Strong native integration between services.
- Reduced maintenance through managed services.
- Easier cost attribution and observability.
- Faster development for a small team.
- Clear architecture and skill requirements.

### Negative

- AWS vendor dependency.
- Service-specific knowledge is required.
- Future migration to another cloud would be substantial.
- AWS cost controls must be implemented from the beginning.

## Guardrails

- Prefer managed and serverless AWS services.
- Avoid Kubernetes unless an accepted ADR demonstrates necessity.
- Avoid multi-region architecture before defined business requirements.
- External providers require security, privacy and data-flow review.
- Every AWS resource is created through Infrastructure as Code.
- Production changes must be auditable.

## Review Trigger

Review only if legal, customer-contract, regional-availability or acquisition requirements mandate another cloud or on-premises deployment.

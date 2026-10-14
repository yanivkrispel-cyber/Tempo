# ADR-0015: S3, Secrets Manager and KMS for Storage Security

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Security, Platform Engineering
- **Related:** ADR-0001, ADR-0009

## Context

Tempo stores user uploads, exports, media, logs, provider credentials and encryption-sensitive data. These require distinct access, lifecycle and audit controls.

## Decision

Use:

- Amazon S3 for application files, exports and immutable artifacts.
- AWS Secrets Manager for provider credentials and database secrets.
- AWS Systems Manager Parameter Store for non-secret application configuration where appropriate.
- AWS KMS for encryption keys used by managed services.
- AWS Certificate Manager for public TLS certificates.

## S3 Rules

- Block Public Access by default.
- Access through application authorization and short-lived signed URLs.
- Separate buckets or strong prefixes/policies by environment and purpose.
- Versioning for critical artifacts.
- lifecycle policies.
- malware scanning workflow.
- checksums and metadata validation.
- object ownership enforced.
- server-side encryption.
- access logging/audit where required.

## Secrets Rules

- No secret values in source control, CDK context, CI variables or application configuration files.
- Workloads use IAM roles to retrieve only required secrets.
- Rotation enabled where supported.
- Secret access is audited.
- Secrets are separate per environment.
- Sensitive provider webhook keys are stored as secrets.

## Encryption Rules

- Managed-service encryption at rest enabled.
- TLS in transit.
- Customer-managed KMS keys only where control/audit requirements justify cost and management; AWS-managed keys are acceptable for lower-risk resources after review.
- Key deletion and rotation follow security policy.

## Consequences

- Strong AWS-native controls.
- KMS and Secrets Manager calls/costs require caching and disciplined usage.
- File authorization remains an application responsibility before signing URLs.

## Amendment 2026-10-14: SSM Parameter Store for Database Credentials

ADR-0021 removes Secrets Manager ($0.40 a month per secret). Database connection details and passwords are SecureString parameters under `/tempo/<env>/db/` in SSM Parameter Store, encrypted with the AWS managed `aws/ssm` key (ADR-0022). Standard parameters are free. A person writes the values. CDK only grants each function read access to its own parameters. Rotation is manual until a tripwire justifies automation.

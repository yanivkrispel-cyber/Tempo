# ADR-0019: Backup, Recovery and Data Protection Strategy

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Platform Engineering, Security
- **Related:** ADR-0005, ADR-0014, ADR-0015

## Context

Managed services provide backup capabilities, but recoverability is not proven until restoration is tested. Tempo must define recovery objectives and protect transactional data, files, infrastructure definitions and deployment artifacts.

## Decision

Use service-native recovery as the default and AWS Backup where centralized policy or compliance adds value.

## Initial Recovery Direction

### Aurora

- Automated continuous backups and point-in-time recovery enabled.
- Backup retention configured by environment.
- Manual snapshot before high-risk migrations.
- Recurring restore drill into an isolated environment.
- Restoration runbook includes creating/attaching DB instances and application validation.

### S3

- Versioning for critical customer files and deployment artifacts.
- Lifecycle rules for prior versions and incomplete multipart uploads.
- Object Lock only when a legal/compliance requirement is approved.
- Replication is deferred until RPO/RTO justifies cross-region cost.

### Infrastructure and Code

- Source and CDK code in protected Git repository.
- Immutable build artifacts retained according to rollback policy.
- Environment configuration reproducible from code and secret references.

## Initial Objectives

Before paid production launch, define and test:

- RPO target for transactional data.
- RTO target for critical customer workflows.
- Maximum acceptable queue replay window.
- File recovery process.
- Credential and DNS recovery.

## Restore Testing

- Staging restore drill at least quarterly after production launch.
- Production backup configuration checked automatically.
- Restore evidence and corrective actions retained.
- A successful backup job is not considered proof of recovery.

## Consequences

- Recovery is treated as an operational capability, not a checkbox.
- Restore drills create controlled cost and engineering work.
- Multi-region active/active is explicitly out of scope initially.

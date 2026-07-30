# ADR-0010: AWS CDK in TypeScript for Infrastructure as Code

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Platform Engineering, Architecture
- **Related:** ADR-0001, ADR-0011, ADR-0014

## Context

All AWS resources must be reproducible, reviewable and consistent across environments. Manual configuration is unsafe and difficult to audit.

## Decision

Use AWS CDK with TypeScript as the primary Infrastructure as Code framework.

## Repository Structure

```text
infrastructure/
  bin/
  lib/
    account-baseline/
    edge/
    identity/
    data/
    api/
    async/
    frontend/
    observability/
  config/
  test/
```

## Rules

- No production resource is created manually except emergency actions recorded and later codified.
- Constructs expose secure defaults.
- Environment configuration is typed and validated.
- CDK context must not contain secrets.
- `cdk diff` is required in pull requests.
- Destructive replacements require explicit approval.
- IAM policies use least privilege.
- Resource names and tags follow a common policy.
- Removal policies differ by environment and data classification.

## Alternatives Considered

- Terraform: strong alternative, but CDK is selected for AWS-native constructs and a single programming model.
- CloudFormation YAML: rejected as primary authoring format due to verbosity.
- Manual console: prohibited for normal delivery.

## Consequences

- TypeScript becomes a required platform skill.
- CDK version upgrades must be managed.
- Generated CloudFormation remains the deployment mechanism.

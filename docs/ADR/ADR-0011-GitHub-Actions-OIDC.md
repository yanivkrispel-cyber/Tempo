# ADR-0011: GitHub Actions with AWS OIDC for CI/CD

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Platform Engineering, Security
- **Related:** ADR-0010, ADR-0014

## Context

The source code is expected to be managed in GitHub. CI/CD requires AWS access without long-lived AWS access keys stored in GitHub.

## Decision

Use GitHub Actions for CI/CD and OpenID Connect federation to assume short-lived AWS IAM roles.

## Pipeline

### Pull Request

- Restore dependencies.
- Lint and format.
- Compile/type check.
- Unit and architecture tests.
- Security and secret scans.
- Integration tests.
- Build artifacts.
- Generate SBOM.
- Run `cdk diff`.

### Merge to Main

- Build immutable signed/versioned artifacts.
- Deploy development.
- Run migrations using controlled job.
- Smoke tests.
- Publish deployment metadata.

### Release

- Deploy staging.
- Automated verification.
- Approval gate.
- Deploy production using rolling/canary strategy appropriate to Lambda.
- Monitor alarms.
- Roll back application artifact or forward-fix schema.

## Security Rules

- No static AWS access keys.
- Separate deployment role per environment/account.
- Trust policy restricts repository, branch/environment and workflow.
- Least-privilege deployment permissions.
- Production uses protected GitHub Environment approvals.
- Build artifacts are immutable and traceable to commit.

## Consequences

- GitHub availability becomes part of the delivery toolchain, not production runtime.
- OIDC trust policy must be carefully constrained.
- Emergency deployment procedure must be documented.

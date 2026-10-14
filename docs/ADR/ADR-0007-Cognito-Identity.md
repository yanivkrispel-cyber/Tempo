# ADR-0007: Amazon Cognito for Authentication Behind an Internal Identity Boundary

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Security
- **Related:** ADR-0004, ADR-0006

## Context

Tempo requires secure user authentication, account verification, federation, MFA capability and standards-compatible tokens without building password infrastructure internally.

Amazon Cognito user pools operate as an OpenID Connect identity provider and support native and federated sign-in models.

## Decision

Use Amazon Cognito User Pools with the Essentials feature plan for customer and staff authentication. Use managed login initially unless product UX requirements justify a custom login implementation.

Tempo remains the source of truth for:

- Internal user ID.
- Person linkage.
- Account business status.
- Organization memberships.
- Roles and permissions.
- Tenant authorization.
- Support impersonation policy.

Cognito remains the source of truth for:

- Authentication credentials.
- Login challenges.
- Verified identity-provider attributes.
- Token issuance.
- MFA configuration managed by Cognito.

## Boundary Rules

- Cognito `sub` is stored as an external identity reference.
- Cognito groups are not the primary business authorization model.
- JWT claims are never accepted as proof of current organization permission without application validation.
- Provider-specific SDK types do not enter the domain layer.
- Account lifecycle events are reconciled idempotently.
- Self-registration is enabled only when explicitly required by product onboarding.

## Security Requirements

- MFA available; mandatory for platform operators and privileged tenant accounts. Passkeys and choice-based authentication may be enabled after client compatibility and recovery flows are validated.
- Secure password/recovery policy where password login is enabled.
- Token validation checks issuer, audience, signature and expiry.
- Revocation/security-version strategy for sensitive account changes.
- Rate and abuse controls.
- Separate Cognito configuration per environment.

## Alternatives Considered

- Custom identity implementation: rejected due to security risk and maintenance.
- External non-AWS identity SaaS: not selected because AWS-native simplicity is preferred.
- IAM Identity Center: used for workforce AWS access, not application users.

## Consequences

- Reduced authentication implementation risk.
- Cognito UX/customization constraints must be managed.
- Migration away requires identity-linking strategy.
- Business authorization remains an internal responsibility.

## Amendment 2026-10-14: Two User Pools (ADR-0023)

- Customers (studio owners, admins, staff, clients) use `tempo-{env}-users`, with self sign-up enabled because studio owners onboard themselves. A new account gets no tenant access until it creates a studio or joins one.
- Platform operators use `tempo-{env}-operators`: MFA required (TOTP), no self sign-up, its own `platform-admin-web` client and shorter sessions.
- The API accepts each pool's tokens only on its own routes. Details in `docs/26_Identity_Organization_Membership_LLD.md` section 2.

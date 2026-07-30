# Authentication and Authorization

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Separation

Authentication identifies the actor. Authorization evaluates allowed actions in tenant and resource context.

## 2. Identity

- global user account.
- canonical person linkage.
- people may exist without login.
- users may join multiple organizations.
- platform operator privileges are separate.

## 3. Authentication Requirements

- OIDC/OAuth-compatible boundary.
- short-lived access.
- revocable sessions.
- MFA/step-up.
- verified contact points.
- secure recovery.
- session listing/revocation.
- invitation reuse of existing identity.
- security-version invalidation.

## 4. Authorization

Hybrid RBAC + ABAC:

- roles group permissions.
- permissions are stable.
- policies include scope/resource constraints.
- default deny.

Permission examples:

```text
organization.settings.manage
people.view
people.update
memberships.invite
memberships.roles.manage
billing.platform.view
files.upload
audit.view
```

## 5. Policy Inputs

- actor.
- user/account status.
- organization.
- membership status.
- role assignments.
- permissions.
- resource ownership.
- relationship.
- entitlement.
- impersonation restrictions.

## 6. Privileged Operations

Step-up + audit for role changes, owner transfer, billing security, sensitive export, impersonation, deletion and integration secret rotation.

## 7. Test Matrix

Test anonymous, no membership, inactive membership, missing permission, correct permission, wrong scope, wrong tenant, platform operator and impersonated operator.

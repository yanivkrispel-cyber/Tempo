# Development Roadmap

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Philosophy

Build Platform Core through a real vertical walking skeleton.

## 2. Phase 0 — Foundation

ADRs, repo, CI/CD, environments, observability, migrations, API/error/event conventions.

## 3. Phase 1 — Identity, Organizations, Tenancy

Accounts, organizations, memberships, invitation, tenant context, isolation, audit and basic platform admin.

## 4. Phase 2 — Authorization and People

Permissions, roles, assignments, Person, OrganizationPerson, contacts, relationships, consent and duplicate candidates.

## 5. Phase 3 — Billing and Entitlements

Plans, subscriptions, provider adapter, webhooks, entitlement snapshots and restricted mode.

## 6. Phase 4 — Communications, Files, Integrations

Templates, delivery queue, provider adapter, uploads, scanning, integration connections and generic webhook intake.

## 7. Phase 5 — First Vertical Walking Skeleton

```text
Create client
→ create vertical work item
→ assign
→ client views/acts
→ staff sees result
→ audit and notification
```

## 8. Phase 6 — Shared Business Modules

Scheduling, CRM, merchant payments, advanced notifications, white label and reporting based on pilot evidence.

Studio marketing (`docs/37_Studio_Marketing_LLD.md`, D23) runs in three stages: A (public studio page, links
with sources, the story generator) and B (member share cards, events, referrals), both built on board #380 before
the pilot; C (video, Meta publishing, AI captions) only after the first paying studio, $0 until then.

## 9. Phase 7 — Production Readiness

Security review, penetration test, DR, SLOs, support, retention, billing ops, incidents, privacy and load tests.

## 10. Epic Template

Business outcome, scope, architecture, model/state, APIs/events, permissions, migrations, telemetry, tests and rollout.

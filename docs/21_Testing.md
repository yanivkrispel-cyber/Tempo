# Testing Strategy

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Pyramid

Many unit/domain tests, medium integration/contract tests, few end-to-end tests.

## 2. Unit

Aggregates, value objects, policies, states, mapping and idempotency decisions.

## 3. Integration

Real PostgreSQL/Redis/queue-compatible dependencies. Repositories, migrations, RLS, outbox, webhook inbox, adapters and files.

## 4. Contract

OpenAPI, generated clients, event schema and provider webhook fixtures.

## 5. End-to-End

Account/organization, invitation, person creation, authorization, billing entitlement, notifications, files, impersonation and first vertical flow.

## 6. Security

Cross-tenant, escalation, revoked session, replay, malicious file, rate limits, fuzzing and export permissions.

## 7. Performance

Critical endpoints, queue burst, imports, fan-out, noisy tenant, contention, cache outage and provider latency.

## 8. Data

Synthetic only in lower environments, deterministic tenant-separated seeds and locale/timezone coverage.

## 9. Gates

PR: build, lint, unit, architecture, changed-module integration and scans.  
Release: full integration, migration, end-to-end, smoke and required performance checks.

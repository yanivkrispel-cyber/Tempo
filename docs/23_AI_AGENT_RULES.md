# AI Agent Rules

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Mandatory Reading

Project overview, relevant architecture document, ADRs, module contracts and tests.

## 2. Prohibited Changes

An agent must not bypass tenancy/authorization, expose exceptions, access private module tables, bind vertical domain directly to providers, create architecture coupling without ADR, store secrets, silently break contracts or perform unsafe migration.

## 3. Required Plan

```text
Goal
Affected modules
Domain invariants
Authorization impact
Tenant impact
Database changes
API/event changes
Failure behavior
Observability
Tests
Rollout/migration
```

## 4. Database Checklist

Tenant ID, constraints, indexes, migration locks, backfill, forward-fix and RLS.

## 5. API Checklist

Permission, schemas, errors, idempotency, concurrency, events and OpenAPI.

## 6. Test Minimum

Happy path, validation, unauthorized, wrong tenant, duplicate retry, concurrency, provider failure and replay.

## 7. Completion Report

Files changed, behavior, assumptions, tests/results, migrations, risks and follow-up.

## 8. Claims

Do not claim production ready, secure, fully tested or backward compatible without evidence.

# Coding Standards

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. General

Clarity, explicit domain behavior, cohesive changes, no hidden state, no swallowed exceptions and tests for new behavior.

## 2. Naming

Commands imperative, events past tense, queries describe result, permission/error keys stable lowercase dot notation.

## 3. Validation

Transport validation at boundary; invariants in domain; strict null/type safety; no arbitrary dictionaries for core updates.

## 4. Logging

Structured, correlated and redacted.

## 5. Async

All I/O async, propagate cancellation, no blocking wait, external timeouts and no fire-and-forget.

## 6. API

Thin endpoints, Problem Details, no domain entities, pagination, authorization and idempotency.

## 7. Database

Reviewed migrations, tenant scope, parameterized SQL, bounded queries and justified indexes.

## 8. Frontend

Strict TypeScript, feature-local code, semantic accessible HTML, centralized API client, server-side authorization and RTL support.

## 9. Git

Small commits, protected main, PR template and generated-file markers.

## 10. Definition of Done

Requirements, review, tests, permissions, telemetry, docs, safe migration and rollout plan.

# DevOps and Platform Operations

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Principles

Infrastructure as code, immutable artifacts, automated delivery, least privilege, isolation, observable releases and tested recovery.

## 2. CI

Restore → lint → compile → unit → architecture → scans → build → integration → SBOM → sign → publish.

## 3. CD

Expand migration → deploy → smoke → metrics → gradual enablement → backfill → validation → contract later.

## 4. Managed Infrastructure

PostgreSQL, Redis, queue, object storage, secrets, certificates, CDN/WAF and observability.

## 5. Secrets

Central manager, workload identity, rotation, environment separation and audit.

## 6. Observability

Structured logs, metrics, traces and business/job telemetry with correlation IDs.

## 7. SLOs

Authentication availability, API latency, queue age, webhook processing, job success and file availability.

## 8. Incidents

Severity, on-call, runbooks, communication, timeline, postmortem and tracked remediation.

## 9. Disaster Recovery

RPO/RTO, restore drills, queue replay, object recovery, DNS/cert recovery and provider continuity.

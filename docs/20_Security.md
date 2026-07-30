# Security Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Objectives

Tenant isolation, identity protection, least privilege, data minimization, auditability, availability and recovery.

## 2. Threats

Cross-tenant access, takeover, escalation, IDOR, webhook replay, malicious upload, secrets, injection, supply chain, impersonation abuse and exfiltration.

## 3. Defense in Depth

```text
WAF/TLS → Authentication → Tenant Context → Authorization
→ Validation → Domain Rules → Database/RLS → Audit/Detection
```

## 4. Classification

Public, Internal, Confidential and Restricted. Each level maps to access, encryption, audit, export and retention controls.

## 5. Controls

Parameterized queries, output encoding, CSRF/CSP, rate limits, strict CORS, upload controls, webhook verification, SSRF protection, safe redirects and dependency scanning.

## 6. Privileged Access

Separate roles, MFA, no shared accounts, JIT where possible, audited reason-bound impersonation and periodic review.

## 7. Logging

Never log credentials, tokens, raw payment data, provider secrets or unrestricted sensitive content.

## 8. Secure SDLC

Threat modeling, review, SAST/DAST, secret scan, dependency policy, SBOM, penetration testing and vulnerability SLA.

## 9. Privacy

Purpose limitation, consent, export/access, deletion/anonymization, retention, legal hold and incident workflow.

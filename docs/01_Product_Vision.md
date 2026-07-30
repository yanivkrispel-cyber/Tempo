# Product Vision

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Vision Statement

Enable every fitness, coaching and wellness business to operate through one intelligent, secure and adaptable digital platform.

## 2. Mission

Tempo replaces fragmented operational tools with a coherent system that connects people, staff, services, schedules, communication, documents, commerce and insights. It allows each vertical product to deliver specialized value while sharing a trustworthy SaaS foundation.

## 3. Strategic Principles

1. **Focused vertical value, shared horizontal infrastructure.**
2. **Mobile-first workflows, not desktop screens compressed onto a phone.**
3. **Single trusted operational record.**
4. **Self-service where safe; assisted operations where complexity or regulation requires it.**
5. **Security and privacy by design.**
6. **Provider independence through internal abstractions.**
7. **Commercial flexibility through entitlements rather than hard-coded plans.**
8. **Internationalization as a platform concern.**
9. **Operational observability from the first pilot.**
10. **AI assists users and developers but does not bypass domain rules, authorization or audit.**

## 4. Product Layers

| Layer | Goal |
|---|---|
| Platform Core | Foundational SaaS capabilities. |
| Shared Business Capabilities | Reusable modules such as tasks, notes, tags, generic commerce infrastructure and reporting foundations. |
| Vertical Products | Industry-specific workflows and terminology. |
| Experience Layer | Role-aware admin, staff and client applications. |
| Data & Intelligence | Analytics, recommendations and AI features based on governed data. |

## 5. Value Propositions

### For business owners

- One operational view.
- Lower administrative overhead.
- Better staff accountability.
- Clear subscription and revenue visibility.
- Brand-consistent client experience.
- Easier growth from solo operation to multi-location business.

### For staff

- Relevant work and clients in one place.
- Clear permissions.
- Less manual coordination.
- Reliable history and communication context.

### For clients

- Self-service access.
- Consistent communication.
- Clear schedules, plans, purchases and history.
- One identity that can participate in multiple organizations.

### For Tempo

- Faster vertical launches.
- Shared operational tooling.
- Reusable integrations.
- Lower security risk.
- Flexible packaging and expansion revenue.

## 6. Non-Goals

Tempo is not initially:

- A generic no-code workflow platform.
- A social network or public marketplace.
- A full accounting ERP.
- A medical record system unless a dedicated regulated vertical is designed.
- A collection of microservices created before operational need exists.
- A system where every vertical entity is reduced to generic “resource” and “activity” records.

## 7. Product Success Model

```mermaid
flowchart LR
    SETUP[Organization Setup]
    FIRST[First Meaningful Workflow]
    REPEAT[Repeated Weekly Usage]
    TEAM[Staff Adoption]
    CLIENT[Client Self-Service]
    DATA[Trusted Operational Data]
    RETAIN[Retention and Expansion]

    SETUP --> FIRST --> REPEAT --> TEAM --> CLIENT --> DATA --> RETAIN
```

## 8. North-Star Outcomes

- Time to first meaningful workflow.
- Weekly active organizations.
- Percentage of staff completing core workflows.
- Client self-service adoption.
- Reduction in manual follow-up.
- Trial-to-paid conversion.
- Net revenue retention.
- Support requests per active organization.
- Critical workflow success rate.

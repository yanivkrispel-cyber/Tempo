# Frontend Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Applications

- Business Administration Web.
- Client / Member PWA.
- Platform Administration Web.
- Future native shells may reuse API contracts and design tokens.

## 2. Structure

```text
src/
  app/
    routing/
    providers/
    shell/
  features/
    identity/
    organizations/
    people/
    billing/
    communications/
    <vertical>/
  shared/
    api/
    auth/
    components/
    design-system/
    forms/
    i18n/
    telemetry/
    utilities/
```

Feature modules import shared infrastructure but not another feature's private implementation.

## 3. State Strategy

| State | Owner |
|---|---|
| Server state | Query/cache library |
| Form state | Local feature form |
| Navigation | Router |
| Session/organization | App provider |
| UI-only | Component |
| Cross-page workflow | Explicit feature store only when necessary |

## 4. API Client

- generated types where practical.
- Problem Details parsing.
- correlation ID.
- token/session handling.
- organization context.
- bounded retries.
- cancellation.
- centralized 401/403 handling.

## 5. Routing

```text
/login
/select-organization
/o/:organizationSlug/
  dashboard
  people
  settings
  billing
  <vertical routes>

/platform/
  tenants
  support
  operations
```

## 6. Design System

Define tokens, primitives, patterns, responsiveness, RTL/LTR, accessibility and brand-safe extensions.

**Decision:** tokens and CSS primitives live in `packages/design-system` (`@tempo/design-system`) and are consumed by all three apps; see `25_Design_System.md` for the direction, themes, RTL and accessibility rules. Each app's `shared/design-system/` holds only React wrappers over those primitives.

**Decision (D16, 2026-10-17):** screens follow the "Warm Glass" direction and its eight principles (`25` section 2): one hero at the top of a home screen, controls floating in glass above content, real photos, one primary action per view. A screen may show only capabilities the API provides (`33_Studio_Experience_LLD.md` section 1).

## 7. White Label

Allowed: logo, constrained palette, app name, supported font preset, legal links.  
Forbidden: arbitrary code/CSS, inaccessible colors, authorization changes, hidden security indicators.

## 8. UX States

Every screen defines loading, empty, validation, denied, entitlement unavailable, partial failure, retry and offline/degraded behavior.

## 9. Security

- UI is not authorization.
- avoid long-lived browser secrets.
- sanitize rich text.
- CSP.
- safe redirects.
- protected file previews.
- telemetry redaction.

## 10. Tests

- component.
- feature.
- contract.
- accessibility.
- visual regression.
- critical end-to-end.
- mobile and RTL.

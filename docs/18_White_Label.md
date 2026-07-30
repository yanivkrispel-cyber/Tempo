# White-Label Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Goal

Tenant branding with accessibility, security and maintainability guardrails.

## 2. Brand Model

Display name, logos, icon, approved colors, theme, locale, legal links, sender profile, custom-domain status and version.

## 3. Resolution

```text
Platform Defaults
→ Vertical Defaults
→ Organization Brand
→ User Preference
→ Accessibility Guardrails
```

## 4. Allowed

Approved assets, constrained palette, name, font preset, email assets, custom domain and localized links.

## 5. Forbidden

Arbitrary JS/CSS, inaccessible contrast, hidden security/legal controls, authorization changes and unreviewed trackers.

## 6. Custom Domain

Request → DNS verification → ownership verification → TLS → routing → renewal monitoring.

## 7. Assets

Validate, optimize, generate variants, remove metadata, version URLs and fallback safely.

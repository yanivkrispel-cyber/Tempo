# ADR-0009: S3, CloudFront, WAF and Route 53 for Web Delivery

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Frontend Architecture, Platform Engineering, Security
- **Related:** ADR-0001, ADR-0004

## Context

Tempo web applications are suitable for static build deployment with API-driven behavior. Running a web server would add compute, patching and scaling work without a current need.

## Decision

Host the Business Admin Web, Client PWA and Platform Admin Web using:

- Private Amazon S3 buckets for build artifacts.
- Amazon CloudFront distributions.
- Origin Access Control between CloudFront and S3.
- AWS WAF for edge protection.
- Amazon Route 53 for DNS.
- AWS Certificate Manager for TLS certificates.

## Deployment Rules

- S3 buckets are not public.
- Artifacts are immutable and versioned.
- Releases use hashed assets.
- HTML has controlled cache duration.
- Rollback selects a prior immutable artifact.
- Security headers and CSP are delivered at CloudFront/application level.
- Separate distributions or strict path/origin policies isolate platform administration where required.
- Access logs and alarms are enabled based on environment.

## White-Label Domains

Custom client domains use verified DNS ownership, managed certificates and explicit tenant-domain mapping. Domain removal must prevent dangling configurations.

## Consequences

### Positive

- Very low idle cost.
- Global CDN.
- No frontend servers.
- Simple rollback.
- Automatic scale.

### Negative

- Pure SPA/PWA limitations for SEO-heavy public pages.
- Cache invalidation and routing must be configured correctly.
- Dynamic server rendering would require an additional architecture decision.

# ADR-0009: S3, CloudFront, WAF and Route 53 for Web Delivery

- **Status:** Accepted, amended on 2026-10-13 (WAF in every environment through the CloudFront Free plan); dev is served by Cloudflare Pages while AWS refuses CloudFront (ADR-0027, 2026-10-17)
- **Date:** 2026-07-30
- **Owners:** Frontend Architecture, Platform Engineering, Security
- **Related:** ADR-0001, ADR-0004, ADR-0021

## Context

Tempo web applications are suitable for static build deployment with API-driven behavior. Running a web server would add compute, patching and scaling work without a current need.

## Decision

Host the Business Admin Web, Client PWA and Platform Admin Web using:

- Private Amazon S3 buckets for build artifacts.
- Amazon CloudFront distributions.
- Origin Access Control between CloudFront and S3.
- AWS WAF for production edge protection. Non-production usage is enabled only when security testing or exposure justifies the recurring cost.
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

## Amendment 2026-10-13: WAF in Every Environment through the CloudFront Free Plan

Each environment's main distribution subscribes to the CloudFront flat-rate Free plan. ADR-0004 describes the subscription.

**What the plan covers at $0:**
- the distribution;
- a WAF web ACL with up to five rules, including their request fees;
- always-on DDoS protection and the TLS certificate;
- the Route 53 hosted zone once one is attached.

**Allowance and limits:**
- 1 million requests and 100 GB a month. These are not hard limits, and there are no overage charges. Sustained excess over several months can lead to slower delivery, until the plan is upgraded.
- Each AWS account can hold three Free plans, so `dev` and `production` each get one.

**Changes to this ADR's rules:**
- WAF is no longer limited to production. It is on from the first deployment of every environment, because it costs nothing on the plan.
- **The five rules:**
  1. AWS common rule set
  2. known bad inputs
  3. IP reputation
  4. a general rate limit
  5. a stricter rate limit on authentication endpoints
- Rule groups that Tempo writes itself are not supported on the plan. Rules are added one by one.
- The web ACL must have `CLOUDFRONT` scope, which exists only in `us-east-1`. The edge stack is deployed in `us-east-1` and needs its own CDK bootstrap there.
- PR preview environments do not get a plan. They use CloudFront pay-as-you-go without WAF, inside CloudFront's Always Free allowance, and are deleted with the PR.
- The plan includes no CloudFront access logs or WAF request logs; those start at the Pro plan. The API's structured logs replace them.

**Tripwire (ADR-0021):** when sustained traffic passes about 1 million requests a month (about 75 studios under the default model), choose between the Pro plan at $15 a month and a second distribution, for example one for staff and one for members.

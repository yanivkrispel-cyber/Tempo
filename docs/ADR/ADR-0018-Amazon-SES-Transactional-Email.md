# ADR-0018: Amazon SES for Transactional Email

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Platform Engineering, Product Operations
- **Related:** ADR-0001, ADR-0008, ADR-0015

## Context

Tempo needs low-cost transactional email for verification, invitations, security messages, billing notices and operational notifications. The email system must handle bounces, complaints, suppression and sender reputation.

## Decision

Use Amazon Simple Email Service (SES) as the default transactional email provider behind the internal Communications provider interface.

## Setup Requirements

- Verify the sending domain.
- Configure DKIM and SPF; configure DMARC before public launch.
- Request production access separately in each sending Region.
- Use configuration sets and event destinations for delivery, bounce and complaint telemetry.
- Use account-level suppression where appropriate.
- Separate transactional and future marketing purposes through policy and configuration.
- Store templates in Tempo's versioned notification-template domain; SES templates are optional implementation details.

## Sandbox Constraint

New SES accounts begin in a Region-specific sandbox. Production onboarding must include a tracked task to request production access and validate the sending domain before customer invitations are enabled.

## Failure Handling

- SES API calls are asynchronous jobs.
- Provider message IDs are recorded.
- Bounce/complaint events enter the webhook/event inbox.
- Permanent failures suppress future sends as required.
- Retry only transient failures.

## Alternatives Considered

External email SaaS providers remain valid adapters if deliverability or product requirements justify them, but SES is the default due to AWS integration and cost.

## Consequences

- Low infrastructure cost and AWS-native telemetry.
- Deliverability operations and reputation remain Tempo responsibilities.
- Sandbox/production access can block launch if left late.

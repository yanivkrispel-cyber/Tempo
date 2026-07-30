# ADR-0016: .NET 10 Managed Runtime for AWS Lambda

- **Status:** Accepted
- **Date:** 2026-07-30
- **Owners:** Architecture, Backend Engineering
- **Related:** ADR-0002, ADR-0003, ADR-0010

## Context

Tempo needs a strongly typed, long-term-supported backend runtime with mature AWS integration. AWS Lambda added a managed .NET 10 runtime in January 2026. .NET 10 is the current LTS release and AWS states that it is expected to receive security and bug fixes through November 2028.

## Decision

Use the AWS Lambda managed .NET 10 runtime for Tempo API and worker functions.

Use:

- ASP.NET Core minimal APIs or the established Lambda ASP.NET Core adapter for the HTTP API.
- AWS SDK for .NET.
- AWS Lambda Powertools for .NET for logging, tracing, metrics and idempotency patterns where appropriate.
- Native AOT only after compatibility, debugging and build-time trade-offs are measured.
- Managed runtime packages rather than container images unless a native dependency or runtime requirement justifies a separate ADR.

## Runtime Rules

- Enable nullable reference types and strict analyzers.
- Pin SDK/tool versions through central package management.
- Keep Lambda handlers thin and route into application modules.
- Reuse AWS clients and safe connection factories across warm invocations.
- Apply trimming/AOT only with automated integration tests.
- Track Lambda runtime deprecation notices and schedule upgrades before end of support.

## Alternatives Considered

### Node.js/TypeScript

Strong ecosystem, but not selected for the backend because the platform benefits from .NET's domain modeling, static analysis and existing team alignment.

### Container Image Runtime

Not selected by default because managed runtimes reduce patching and image maintenance.

## Consequences

- One primary backend language and toolchain.
- Runtime upgrades must be treated as planned engineering work.
- Cold-start and package-size performance must be measured continuously.

## Review Trigger

Review at every .NET LTS release and twelve months before AWS Lambda runtime deprecation.

## Official Reference

- AWS Lambda adds support for .NET 10, 2026-01-08.

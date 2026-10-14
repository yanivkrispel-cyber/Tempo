# ADR-0024: Frontend Toolchain for the Tempo Web Apps

- **Status:** Accepted
- **Date:** 2026-10-14
- **Approved by:** Kris (project owner), 2026-10-14
- **Owners:** Frontend Architecture
- **Related:** ADR-0009, ADR-0021, `06_Frontend_Architecture.md`, `25_Design_System.md`

## Context

Phase 1 needs the first two web apps: the client PWA (`apps/client-web`) and the business admin web
(`apps/admin-web`). `06_Frontend_Architecture.md` names the roles (a router, a query/cache library for server state,
a generated API client) but not the libraries. ADR-0009 delivers every app as a static build from private S3 behind
CloudFront, so there is no server rendering. The design tokens and CSS primitives already live in
`@tempo/design-system`. The API is described by `contracts/openapi/tempo-api.v1.yaml`.

## Decision

All Tempo web apps use the same toolchain:

| Concern | Choice |
|---|---|
| Build and dev server | Vite, static output only (no SSR) |
| UI | React 19 with TypeScript (strict) |
| Routing | React Router 7 in data mode (`createBrowserRouter`), client-side only |
| Server state | TanStack Query |
| API client | `openapi-typescript` generates types from the OpenAPI contract; `openapi-fetch` makes the calls |
| Tests | Vitest with Testing Library (`@testing-library/react`, jsdom) |
| Styles | `@tempo/design-system` tokens and `tp-*` classes, wrapped by typed React components per app |

1. **One shared API client.** `packages/api-client` holds the generated types and a thin `openapi-fetch` client
   (Problem Details parsing, correlation ID, auth headers). Apps never hand-write request or response types.
   CI fails when the generated file is out of date with the contract.
2. **Hebrew and RTL first.** Each app's `index.html` sets `lang="he" dir="rtl"`. Layout uses logical CSS properties,
   as `25_Design_System.md` requires.
3. **Secrets never in the URL path.** Invitation and join links carry their token in the fragment
   (`/invite#<token>`, `/join#<code>`). The app reads `location.hash` and sends the value in the request body.
4. **CI.** Each app builds, type-checks and runs its Vitest suite in the existing Frontend CI job.

## Cost

$0. All of these are open-source npm packages that run at build time or in the browser. Nothing here bills
(ADR-0021).

## Alternatives Considered

| Option | Why not |
|---|---|
| Next.js or another SSR framework | Needs a server or edge runtime; ADR-0009 serves static files from S3. |
| Create React App | Unmaintained. |
| Redux Toolkit / RTK Query | More code for the same job; server state is the main state and TanStack Query covers it. |
| Hand-written fetch client or Orval | Hand-written types drift from the contract. `openapi-fetch` is a thin runtime with no code generation beyond types. |
| Jest | Needs a separate transform setup; Vitest reuses the Vite config. |

## Consequences

- One toolchain for all three apps, so wrappers, test setup and lint rules can be shared.
- A contract change shows up as a TypeScript error in the apps at build time.
- React Router's framework mode (its Vite plugin, server rendering) is not used. Revisit if an app ever needs
  server rendering.

## Review Trigger

Review when an app needs server rendering, when a library here stops being maintained, or when native shells
(`06_Frontend_Architecture.md` section 1) are planned.

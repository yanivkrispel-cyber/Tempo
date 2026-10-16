# @tempo/api-client

Typed client for the Tempo API (ADR-0024). Types are generated from `contracts/openapi/tempo-api.v1.yaml` by
`openapi-typescript`; calls go through `openapi-fetch`.

```ts
import { createTempoClient, unwrap } from "@tempo/api-client";

const api = createTempoClient({ baseUrl: import.meta.env.VITE_API_URL, getAccessToken: () => session.accessToken });
const me = await unwrap(api.GET("/api/v1/me")); // typed data, or throws TempoApiError
await unwrap(api.POST("/api/v1/invitations/accept", { body: { token } })); // the token from location.hash
```

- Every request gets `X-Correlation-Id`, and the token as `Authorization: Bearer`, or as `X-Tempo-Authorization`
  with `authHeader: "X-Tempo-Authorization"` when the API is reached through CloudFront.
- `TempoApiError` carries `status`, the Problem `code`, `correlationId` and `retryAfterSeconds` (on 429).

## When the contract changes

```sh
pnpm --filter @tempo/api-client generate   # rewrites src/generated/schema.ts
```

Commit the result with the contract change. The Frontend CI job fails when the file is out of date.

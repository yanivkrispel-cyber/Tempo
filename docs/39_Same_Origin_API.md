# Same-origin API: what the CORS preflight costs, and the options

Board #553 (K6, W-6), 2026-11-01. **A design note only: nothing is built.** Board #537 K1 found that a member's
first visit spends more time on round trips than in the handler, and part of that is the CORS preflight. The apps
are on `*.pages.dev` (Cloudflare Pages, ADR-0027) and the API is on `*.execute-api.eu-central-1.amazonaws.com`, so
every call is cross-origin. This note measures the cost, compares three ways out and gives a default for the owner.

## Why there is a preflight at all

Every API call carries `Authorization: Bearer ...`, which makes it a non-simple request, so the browser first sends
`OPTIONS` to the same URL and waits for the answer. The browser caches the answer per URL and origin for
`Access-Control-Max-Age`. Ours is 7,200 s (`api-stack.ts`, `corsPreflight.maxAge`; 3,600 s when measured below). Chrome caps it at 7,200 s.
WebKit (Safari, and every browser on an iPhone) probably keeps an entry for at most 10 minutes, which is **to
verify** in WebKit's source before relying on it. A fresh tab cache, a new URL (another organization id, another
booking id, another query string) or an expired entry pays it again. API
Gateway answers the preflight itself (`apigw-requestid`, no Lambda), so its cost is only the network: **one round
trip, plus a new TLS connection to a second host on a first visit.**

Making the calls simple instead (a cookie instead of the header) would bring back CSRF and the token handling
`docs/26` chose against, so it is not an option.

## What it costs (measured)

| Measure | Value | Source |
|---|---|---|
| Preflight answer, warm connection, from the dev machine (broadband, Israel to Frankfurt) | 75 to 85 ms (one round trip) | `curl -X OPTIONS` five times on 2026-11-01: 204, `max-age: 3600`, no Lambda |
| A new connection to execute-api from the same machine | TCP about 77 ms, plus TLS about 85 ms | The same `curl` runs |
| A member's first `POST /session` vs a repeat visit, phone profile (Pixel 7, Slow 4G, CPU 4x) | 385 to 444 ms vs 174 to 201 ms (median per screen) | `tests/e2e/perf/after-2026-10-27.json`, 10 screens, 3 runs each |
| Distinct API URLs on a first visit | 2 to 8 per screen (profile 8, console today 6, book 5) | The same file |

So on the phone profile, the first call of a first visit pays **about 200 to 250 ms** more than a repeat: the second
host's DNS, TCP and TLS, plus the preflight. Each other distinct URL pays its own preflight round trip. Most run in
parallel, but the ones on the first paint's path (session, then the screen's read) are in series. A fair estimate of
what same-origin would save on a first visit is **one connection setup plus one or two serial round trips: about
200 to 400 ms of the first useful paint** on the phone profile, and little on a repeat visit within the hour.

**Not measured yet:** the preflight count and time per screen, as the phone sees them. Playwright's
`page.on("request")`, which `screens-perf.mjs` uses, doesn't surface CORS preflights, so today's API-call counts leave
them out. [O] adds a CDP count in O6 (`Network.requestWillBeSent` with `type: "Preflight"`, and `loadingFinished` for
the time) as two fields per screen, `preflights` and `preflightMs`, measured on Chromium only. The numbers above
should be checked against it before anything is built.

## The options

### A. Stay cross-origin, and cache the preflight longer ($0)

- `maxAge` from 1 hour to 2 hours, Chrome's cap. That halves the preflights on return visits within two hours.
- Keep the per-URL variety down where it is cheap. Most screens already read under one organization id.
- The cache key is the full URL, query included. Reads like `?from=<date>` (the timetable, the twelve weeks) get a
  new URL every day, so they pay a preflight on each day's first visit whatever `maxAge` is.
- **Saves:** some repeat-visit preflights on Chrome; nothing on a first visit. If WebKit's 10-minute cap holds,
  nothing past 10 minutes for iPhone members, who are most members in Israel.
- **Cost and risk:** none; a one-line CDK change with a test.

### B. A Cloudflare Pages proxy for `/api/*` on each app's origin

The client app already runs an advanced-mode `_worker.js` (link previews, SL-9). Every request to the app passes
through it and goes to `env.ASSETS` unless it is a crawler. A branch for `/api/*` would forward the request to the
API, and the apps would call `/api/v1/...` on their own origin.

- **Saves:** the preflight on every call, and the second host's connection. The worker runs at the Cloudflare edge
  near the member and keeps its connection to Frankfurt warm. Expect the 200 to 400 ms above on a first visit; to be
  measured.
- **Cost:** Cloudflare's Workers free plan, which Pages Functions share, allows 100,000 requests a day. Dev uses
  about 2,600 API requests a day (77,593 in 30 days) on top of the page requests the worker already handles. At the
  roadmap's 1,500 members in 50 studios, member traffic could pass 100,000 a day, which means Workers Paid at
  US$5 a month (ADR-0021: the owner's approval). **Verify the limits on Cloudflare's pricing page before building.**
- **Risks, all fixable but real:**
  - *The client's address.* The API would see Cloudflare's addresses, not the member's. `ClientAddress.Of` trusts
    only API Gateway's source and CloudFront's viewer header, so every limiter keyed on the address (the join
    limiter, `PublicRateLimitFilter`) would put all members behind a few Cloudflare egress addresses into one
    bucket. The proxy must pass `CF-Connecting-IP`, and the API may trust it only when the request is proven to come
    from the proxy (a shared secret header written by a person in SSM, or mTLS).
  - *A new place for tokens.* Every bearer token passes through the worker. It must never log one, and the worker's
    code is then security-relevant (review, tests, `no-raw-html`-style guards).
  - *Two paths to the API.* execute-api stays public on dev. In production, #122 (#555) already turns it off behind
    the AWS edge. With Cloudflare in front instead, the same question returns: the API must accept only the proxy.
  - *Outages stack.* A Cloudflare incident takes down the app and the API together. Today it takes only the app.
- **Which app:** `_worker.js` exists only in the member app. The console has none, so B there means a new worker
  that sees staff tokens. The console is used on desktop broadband, where a preflight costs about 80 ms, so B is
  likely worth it for the member app only.
- **When:** not before the custom domain (#304), because a proxy on `*.pages.dev` would have to be built again on
  the real domain.

### C. A custom domain for the API

`api.<domain>` next to `app.<domain>`: same-site, but **still cross-origin**, so the preflight stays. A custom
domain alone doesn't remove it. It helps only together with B (the proxy on the app's own host), or with an edge
that routes `/api/*` on the app's host. That is what production planned with CloudFront (ADR-0009 amendment), which
AWS refused (ADR-0027).

## Default

1. **Now: A**, done on 2026-11-06 (board #612 K7): `maxAge` 2 hours, with a test. $0.
2. **Measure first:** [O] adds the preflight count and time to `screens-perf.mjs` in the next after run.
3. **With the custom domain (#304): decide B for the member app**, with the numbers from step 2 (WebKit's cap
   included), the request volume at that time and the four risks above. It needs the owner's approval if it could pass the free plan.

Nothing in this note changes code, infrastructure or the contract.

## Open question for the owner

| Id | Question | Default |
|---|---|---|
| SO-1 | Take option B (a proxy on the app's origin) when the custom domain arrives? | Decide then, with the measured gain; A until then |

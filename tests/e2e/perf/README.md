# Performance scripts

Plain Node scripts on Playwright, outside the test runner. They measure the deployed dev apps on Cloudflare Pages
on a mid-range phone profile (Pixel 7, Slow 4G, CPU slowed 4x). They're for comparing before and after a change,
not a CI gate.

| Script                       | What it measures                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `screens-perf.mjs [outFile]` | Each key screen of both apps, first and repeat visit: FCP, LCP, CLS, API calls, JS bytes. `PERF_RUNS` (default 3) |
| `inp.mjs`                    | Tap responsiveness (Event Timing, what INP reports) on the member tabs and the console menu                       |
| `cls-debug.mjs`              | Which elements shift during load on one screen                                                                    |

`baseline-2026-10-20.json` is the baseline from the perf audit of 2026-10-20 (3 runs per screen).

They need `.auth/smoke-user.json` signed in on the **deployed** apps. Make it with the sign-in project pointed at
Cloudflare Pages (Playwright then reuses those URLs instead of starting the local servers):

```sh
E2E_ADMIN_URL=https://tempo-studio-console.pages.dev E2E_CLIENT_URL=https://tempo-members.pages.dev \
  npx playwright test --project=sign-in
node perf/screens-perf.mjs perf/result.json   # from tests/e2e
```

`.auth/` holds tokens and is ignored by git.

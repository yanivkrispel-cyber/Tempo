# Runbook: service level objectives (SLOs)

Board #553 (K5, 2026-11-01), for #544. Production readiness item 4b (`docs/runbooks/production-readiness.md`) asked
for numbers that are written down and measured. `docs/19_DevOps.md` section 7 says what to measure. This file gives
the numbers, a month of dev against them, and what a missed SLO starts.

**Status: proposed.** The project owner approves the targets (#544). Until then they are the defaults.

## The four SLOs

| # | SLO | Target (a calendar month) | Measured by | Error budget |
|---|---|---|---|---|
| 1 | API availability | 99.5% of the canary's health checks succeed | Canary results (every 5 minutes) | About 3.6 hours, or 43 failed checks out of 8,640 |
| 2 | The signed-in path | 99% of the hourly signed-in checks succeed | Canary deep check (sign in, `GET /me`, one tenant read) | 7 failed checks out of 720 |
| 3 | Latency of warm requests | p95 under 1 s and p99 under 2 s, measured in the handler | Serilog's request line (`Elapsed`), per route; `tests/e2e/perf/` for the phone's view | Not a budget: two weeks above the target is a performance item on the next board |
| 4 | Background work | Nothing in the DLQ for more than one business day; the oldest message under twice the visibility timeout | The two queue alarms (`work-dlq-messages`, `work-oldest-message-age`) | No budget: every breach is an incident (`incidents.md`, SEV3) |

What the SLOs don't promise:

- **Cold starts** are tracked, not promised. A first request after idle pays the Lambda init (about 3.5 s after board
  #445) plus a Neon wake. The paid levers that would remove them (provisioned concurrency, an always-on database) are
  outside ADR-0021.
- **A Neon wake** after five minutes idle is part of a cold request, not an outage.
- **Maintenance** announced a day ahead to the studios doesn't count against availability.

Requests from our own load or perf runs are counted separately (below), not left out silently.

## Dev against the targets (2026-10-02 to 2026-11-01)

Read on 2026-11-01 with read-only CloudWatch queries: aggregate counts only, no request content. Dev keeps logs for
14 days, so the canary numbers cover 2026-10-18 to 2026-11-01. The metrics cover 30 days.

| SLO | Dev | Met? |
|---|---|---|
| 1. Availability | 4,032 of 4,032 health checks ok (100%) | Yes |
| 2. Signed-in path | 329 of 336 deep checks ok (97.9%). The 7 failures were on 2026-10-18 (6) and 2026-10-19 (1), during the Warm Glass deploys. None since 2026-10-20 (100%) | No for those 14 days; yes since 2026-10-20 |
| 3. Latency | Handler p50 about 100 ms and p90 200 to 585 ms on the member routes (board #537 K1). The Lambda's daily p95 has a median of 1,075 ms and its daily p99 a median of 2,021 ms, cold starts included. The API Gateway's daily p95 median is 988 ms, and its p99 median is 2,854 ms | Warm: yes. Including cold starts: no, as expected |
| 4. Background work | One message sat in the DLQ from 2026-10-14 to 2026-10-28, and SQS dropped it after 14 days. It came from the seven outbox worker errors on 2026-10-14. The work queue never held a message for long | **No**: the DLQ wasn't read for 14 days |

Other numbers from the same 30 days:

- **API:** 77,593 requests and 47,988 Lambda invocations, with 0 function errors.
- **5xx:** 763 answers (0.98%), all between 2026-10-15 and 2026-10-20, with none since. 711 of them are Lambda
  throttles: reserved concurrency is 20 on dev, and our own e2e and perf bursts went past it. The days match exactly
  (2026-10-15 28, 10-16 216, 10-17 311, 10-18 46, 10-20 110). Production's concurrency is set by #298. Note: a burst
  by anyone, not only by us, gets the same 429 or 503 (#560).
- **4xx:** 975 answers, mostly expected: refused sign-ins, 404s in tests, and 409 conflicts.

What dev teaches for production:

1. The DLQ needs an owner. In production its alarm emails. On dev there is no alarm (dev keeps zero alarms), so the
   weekly look below includes it.
2. Our own load is the biggest source of 5xx. Perf runs need the concurrency headroom checked first, and they are
   counted apart.
3. The signed-in check failed during a burst of deploys. Two deploys in a row without a pause each restart the
   function, and the check lands in between.

## Measuring

```text
# 1 and 2: the canary, a month (production keeps logs for 90 days)
filter message like /"check"/
| parse message /"check":"(?<check>[a-z]+)","ok":(?<ok>true|false)/
| stats count() as n by check, ok

# 3: warm handler time per route (Serilog's request line, since #557)
filter RequestPath like /\/me\/progress$/
| stats pct(Elapsed, 50), pct(Elapsed, 95), pct(Elapsed, 99)

# 4: the alarms' history (production), or the queue's metrics on dev:
aws cloudwatch get-metric-statistics --namespace AWS/SQS --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=tempo-dev-work-dlq --statistics Maximum --period 86400 ...
```

The board's after numbers (`tests/e2e/perf/`) are the phone's view (Slow 4G, 4x CPU). They are not an SLO, but a
change that makes them worse needs a reason on its board.

## When an SLO is missed

- **A missed SLO opens an incident note** (`incidents.md`, SEV3 unless it meets a higher severity), not a page at
  night. There is no on-call rota (one person, `docs/19`).
- **Half of a month's budget gone** in the first half of the month: the next board fixes the cause before new
  features.
- **Weekly look** (Monday, 10 minutes): the canary counts, the DLQ, and the 5xx days. Write the result on the board of
  that day.
- **Review the targets** after the first three months of production, with the real numbers.

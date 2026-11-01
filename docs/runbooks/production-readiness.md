# Runbook: production readiness

Draft, written on 2026-10-28 (board #537, task K4, decision V-5). It covers every phase 7 item of
`docs/24_Development_Roadmap.md` section 9: security review, penetration test, DR, SLOs, support, retention,
billing operations, incidents, privacy and load tests. For each item it gives the state on `main`, the issue that
tracks it, and what must happen before the first paying studio. The pilot's own path is in
`docs/runbooks/pilot-readiness.md`; this page starts where that one stops.

## What "production" means here

- **A separate environment.** Its own AWS account (ADR-0014: "production must remain separate"), its own Neon
  project (ADR-0022), its own Cognito pools and its own Cloudflare Pages projects or edge. Dev keeps running as
  it does. `infrastructure/config/production.ts` exists and synthesizes in CI (`TempoProd` in
  `infrastructure/bin/tempo.ts`), but every account-specific value in it is a placeholder (account
  `000000000000`, Neon project `not-created-yet`, `*.tempo.example` hosts). Nothing has been deployed.
- **It opens for the first paying studio.** The pilot runs on dev and holds no money. Production exists for the
  first studio that pays, and not before (ADR-0021, #299).
- **$0 until revenue.** ADR-0021 still applies the day production opens. Anything below that bills is listed with
  its monthly cost and is marked **needs Kris's approval**. The fixed-cost guard
  (`infrastructure/test/unit/fixed-cost-guard.test.ts`) and the alarm budget
  (`infrastructure/test/unit/alarm-budget.test.ts`: zero alarms in dev, exactly ten in prod) keep failing CI on
  anything that slips through.

Owners: **Kris** decides, pays, signs and holds the keys; **dev** is whoever builds it (Kris's machine for
`backend/`, `infrastructure/`, `docs/`; Ofir's for `apps/`, `packages/`).

## The items at a glance

State on `main` on 2026-10-28. "Done" means built and checked on dev; "partial" means some of it exists;
"missing" means nothing on `main` yet. The issues #541 to #549 were opened with this runbook.

| # | Item | State on `main` (evidence) | Tracking issue | Before the first paying studio | Owner |
|---|---|---|---|---|---|
| 0 | Production environment | **missing**: config only, placeholders (`infrastructure/config/production.ts`); prod plans CloudFront, which AWS refused on 2026-10-17 (ADR-0027) | #299; #298 (Lambda quota 40); #241 (TLS) | Account, Neon project, edge decision, domain, first deploy | Kris + dev |
| 1a | Security review: automated gates | **done**: gitleaks, Semgrep, dependency audits, cdk-nag, IAM Access Analyzer, `security-reviewer` agent (`.github/workflows/pull-request.yml`, `infrastructure/lib/security/security-stack.ts`, `.claude/agents/`) | #295 (closed) | Keep green | dev |
| 1b | Security review: open findings | **partial**: four open decisions | #96, #97, #122, #123, #303 | #122 fixed; #123 and #303 decided; #96 and #97 closed or accepted | Kris + dev |
| 1c | Security review: one end-to-end review of `main` for production | **missing** | #541 | A written review, findings fixed or accepted | dev |
| 2 | Penetration test | **missing**; `SECURITY.md` forbids testing the shared dev environment | #542 | A $0 scan on a production-like stage at least; a paid test only with approval | Kris |
| 3a | DR: backups and RPO | **partial**: Neon 6-hour restore window on Free, below the 24-hour RPO (ADR-0019 amendment); no `pg_dump`; media bucket `versioned: false` (`infrastructure/lib/api/api-stack.ts`) | #543 | Choose Neon Launch or a daily `pg_dump`; write the RPO | Kris |
| 3b | DR: restore drill | **done on dev**: 4.1 s to a branch, `tools/scripts/neon-restore-drill.mjs`, `docs/runbooks/restore.md` | #269 (closed) | Run it once on the production project | dev |
| 3c | DR: RTO and non-database recovery (secrets, health key, DNS, deploy) | **partial**: RTO 4 h provisional (`docs/01_AWS_Infrastructure_LLD.md` 28.4); health key copy undecided | #308; #543 | RTO approved; health key copy decided; one full rebuild rehearsed | Kris + dev |
| 4a | Monitoring: alarms and canary | **partial**: ten prod alarms in code (pinned by `alarm-budget.test.ts`), dev canary every 5 min plus hourly signed-in read (`infrastructure/lib/observability/dev-canary-stack.ts`); canary email unconfirmed | #302; #270 (closed) | Alarms deployed and routed; canary email confirmed | Kris |
| 4b | SLOs | **missing**: `docs/19_DevOps.md` section 7 lists what to measure, no numbers | #544 | Three numbers written and measured | dev, Kris approves |
| 5 | Support | **missing**: no support channel or process; operator suspend and notes exist; impersonation not built (`docs/26` section 2) | #546 | A channel, hours, a first-answer promise, operator registered (#301) | Kris |
| 6 | Retention | **partial**: daily job (`backend/Tempo.Platform/Modules/Retention/Application/RetentionJob.cs`, 90/180/90/90 days), log retention 90 days in prod config; no rule for audit events; days provisional | #307, #315, #306 | Days confirmed with the lawyer; audit-event rule added | Kris |
| 7 | Billing operations | **partial**: state machine and restricted mode built (thin, `pilot` plan only, docs/28); no provider, no invoices | #278; #547 | Provider chosen; invoice and refund process written | Kris |
| 8 | Incidents | **missing**: no incident runbook; `docs/runbooks/restore.md` covers one kind | #545 | A one-page runbook with severities, contacts and the breach-notification step | dev, Kris approves |
| 9a | Privacy: export, erase, account deletion | **done on dev**: `POST /people/{id}/export`, `POST /people/{id}/erase`, `DELETE /me`, studio removal | #276 (closed); #315 | The deletion promise says what Neon history keeps | dev |
| 9b | Privacy: health form and consent texts | **blocked on Kris**: drafts only | #306 | Lawyer-approved wording live | Kris |
| 9c | Privacy: privacy policy, terms, studio agreement (Tempo processes data for the studio) | **missing** | #548 | Published policy and terms; a signed agreement per studio | Kris |
| 9d | Privacy: Israeli law (Amendment 13, Data Security Regulations 2017) | **missing**: no written assessment | #548 | Lawyer's reading of what applies, and the security procedure document | Kris |
| 10 | Load test | **partial**: small booking test (`tools/scripts/booking-load-test.mjs`, 60 requests); full test waits for #97 | #300 | Full test on a production-like stage, numbers in this runbook | dev |
| 11 | The public repository | **open rule**: public since 2026-10-15 (D14); harden or make private before production | #549; #96, #97 | Kris decides | Kris |

## 0. The production environment (#299)

**Exists.** The production config and its invariants (`validateEnvironmentConfig`, `production-safety.test.ts`):
deletion protection on, operator MFA required, log retention 90 days, X-Ray on, ten alarms, WAF and frontend hosting
on, public throttling at reads 10 rps (burst 12) and join 2 rps (burst 4).

**Missing.**
- The account, the Neon project and every real value in `production.ts`.
- An edge that exists. The config turns on CloudFront (`enableFrontendHosting: true`), but AWS refused CloudFront
  on 2026-10-17 (case in `docs/claude-memory/aws-and-deploy.md`). ADR-0027 says a new ADR decides if it is still
  refused at production time. Two of the ten prod alarms (`cloudfront-5xx-rate`, `canary-failure`) live in the
  edge stack, so the alarm list changes with that ADR.
- The Lambda concurrency quota is 40 (#298); the prod config reserves 50 plus 20.
- A domain (#304, #241). Email, CORS, the passkey relying party and Cognito callbacks all wait for it.

**Steps.** (1) Kris opens the production account under the Organization (no cost by itself). (2) A new ADR: edge on
CloudFront or on Cloudflare Pages, as dev. (3) Domain bought (about $10 to $15 a year, **needs Kris's approval**;
ADR-0021 tripwire "Domain needed"). (4) Neon production project on Launch (item 3a). (5) Real values in
`production.ts`, reviewed in a PR. (6) Bootstrap and deploy with the scoped role decided in #123. (7) Smoke test,
canary, alarms green for seven days before the studio's data goes in.

**Acceptance.** `cdk synth` for `TempoProd` has no placeholder; the smoke test passes against the production URL;
the canary is green for seven days.

## 1. Security review

**Exists.** Every PR runs gitleaks, Semgrep (new findings), the NuGet vulnerable-package check, the pnpm audit
(high and critical), cdk-nag and the IAM wildcard test (`.github/workflows/pull-request.yml`,
`infrastructure/test/unit/cdk-nag.test.ts`, `iam-wildcard.test.ts`). IAM Access Analyzer runs on the account
(`security-stack.ts`). The local `security-reviewer` agent advises before review (D13, ADR-0025). Past sweeps:
#109, #114, #115, #121, #124 (all closed). Cross-tenant checks: row-level security as a second layer, integration
tests in `tests/Tempo.IntegrationTests/`.

**Open findings.**

| Issue | Finding | Default if Kris says nothing |
|---|---|---|
| #122 | execute-api stays public behind the edge, so WAF can be bypassed | Fix before production: `disableExecuteApiEndpoint` when an edge fronts the API, plus a CDK test (dev change, $0) |
| #123 | CI deploys as administrator of the management account | Production in its own account with a scoped CDK execution policy; option 3 or 4 in the issue |
| #303 | Owner MFA (`TEMPO_REQUIRE_OWNER_MFA`) is off | On in production from day one; the enrollment screen exists (#127, #150) |
| #96 | Team email addresses in tracked files | Placeholders in files; history stays |
| #97 | Dev discoverable, self sign-up open | Option B from the issue (dev-only allow list), recommended there |

**Missing.** One written review of `main` as it will ship, against `docs/20_Security.md` sections 2 and 5: tenant
isolation, authorization per route, the public surface (D24), uploads, secrets, logging of personal data, the
operator pool. Also the security procedure document that the Data Security Regulations ask of a database owner
(item 9d).

**Steps.** (1) A dev runs the review from `docs/20` section 2 route by route, with the `security-reviewer` agent,
and writes the findings into the new issue. (2) Fix or accept each with Kris. (3) Repeat on every major change and
at least once a year.

**Acceptance.** Every high and medium finding is fixed or accepted by Kris in writing; #122 is closed.

## 2. Penetration test

**Exists.** Nothing. `SECURITY.md` invites private reports and forbids scanning the dev environment.

**Missing.** A test by someone who did not write the code.

**Steps and default.** Two tiers.
1. **$0, before the first paying studio:** an OWASP ZAP baseline scan and an authenticated API scan against a
   temporary production-like stage (a Neon branch and a throwaway stack), never against dev. The results go into the
   issue.
2. **Paid, external test:** cost unknown until a quote; **needs Kris's approval**. Default: after the first
   paying studio and before about ten studios, or earlier if a studio's contract asks for it. Whether the Data
   Security Regulations require periodic penetration tests at Tempo's level is **to verify** with the lawyer
   (the IAPP summary below ties them to the high level).

**Acceptance.** The $0 scan has no unexplained high finding; the paid test is booked or explicitly deferred by Kris.

## 3. Disaster recovery

### 3a. Backups and RPO

**Exists.** Neon point-in-time restore inside the plan's window: 6 hours on Free (`docs/claude-memory/database-neon.md`).
A Neon branch before risky migrations (ADR-0019 amendment). Infrastructure is code; secrets are in SSM.

**Missing.** The 24-hour RPO from council Q5 is not met past the 6-hour window: a mistake found the next morning
cannot be undone. The media bucket has no versioning. ADR-0019's amendment says the owners choose before the pilot
between a scheduled `pg_dump` to S3 and Neon Launch's window of up to 7 days.

**Default.** Neon Launch for the production project (ADR-0021 tripwire "First paying studio": about $3 to $19 a
month, **needs Kris's approval**), with a 7-day window. A daily `pg_dump` to S3 stays the $0 fallback if Kris says
no (a scheduled Lambda; S3 storage of a small dump costs cents). Media bucket versioning with a 30-day noncurrent
expiry (cents at pilot size, **needs Kris's approval** as a billing change). The 10-studio tripwire
(`messaging-stack.ts`, daily count of active organizations) moves backups to hourly.

**Acceptance.** RPO written here and in ADR-0019; the chosen backup runs; a restore from it is tested once.

### 3b. Restore drill

**Exists.** `tools/scripts/neon-restore-drill.mjs` and `docs/runbooks/restore.md`: on 2026-10-15 a branch 30
minutes back was ready in 4.1 s, the migration journal and row counts matched, the whole drill took 12.4 s.

**Before the first paying studio.** Run the drill against the production project (`--environment prod`, after the
`/tempo/prod/neon/api-key` parameter exists) and add the numbers to `restore.md`. Then monthly and before every
Neon plan change, as `restore.md` says.

### 3c. RTO and recovery beyond the database

**Exists.** A provisional RTO of 4 hours for initial commercial production (`docs/01` section 28.4). Restore steps
for the database (`restore.md`, "A real restore").

**Missing.**
- The health data key (`/tempo/<env>/health/data-key/<v>`, ADR-0026): if the parameter is lost, every health answer
  is unreadable. Whether to keep an offline copy is #308.
- Rebuilding an environment from scratch: CDK bootstrap, the SSM values a human writes (the list is in
  `database-neon.md`), Cognito pools (users cannot be exported with passwords), DNS and certificates once the
  domain exists. Never rehearsed.
- The queue: the DLQ alarm exists in prod config, a replay procedure does not (`docs/19` section 9).

**Default.** RTO 4 hours approved as is. #308: docs/31 section 7.1 leaves the key copy open ("an open item, not
a default"); this runbook proposes one offline copy of the production key on an encrypted drive held by Kris, since
losing it means every member signs again (docs/31: "Members sign again"). One rebuild of a throwaway stage from an
empty account before the studio's data goes in.

**Acceptance.** A written list of every human-held value and where it is kept (not the values); the rebuild took
less than the RTO.

## 4. SLOs and monitoring

### 4a. Alarms and canary

**Exists.** Ten prod alarms in code: `lambda-errors`, `lambda-throttles`, `api-duration-p99` (2,000 ms over three
5-minute periods), `work-dlq-messages`, `work-oldest-message-age`, `neon-free-limit` (70%), `ses-bounce-rate`,
`ses-complaint-rate`, `cloudfront-5xx-rate`, `canary-failure`. The dashboard (#145). The dev canary checks
`/api/v1/health` every 5 minutes and a signed-in read every hour, and emails at two failures out of three
(`docs/claude-memory/aws-and-deploy.md`).

**Missing.** The canary's SNS subscription is unconfirmed and CI's smoke test cannot sign in (#302). The
`neon-free-limit` alarm means little once production is on Launch; it should turn into a Launch-spend alarm (still
one of the ten).

### 4b. SLOs

**Missing.** `docs/19` section 7 lists what to measure; there are no numbers.

**Default** (dev proposes, Kris approves; all measured with what exists, $0):

| SLO | Target | Measured by |
|---|---|---|
| API availability | 99.5% of canary health checks in a calendar month (about 3.6 hours down) | Canary results |
| Signed-in path | 99% of the hourly signed-in checks | Canary deep check |
| Latency | p95 under 1 s and p99 under 2 s for warm requests; cold start tracked, not promised | Lambda duration, `tests/e2e/perf/` |
| Background work | Nothing in the DLQ for more than one business day; oldest message under twice the visibility timeout | The two queue alarms |

A missed SLO opens an incident note (item 8), not a page at night: one person, no on-call rota.

**Acceptance.** The table above is approved and a month of dev numbers is written next to it.

## 5. Support

**Exists.** The operator pool with MFA (D8), operator notes and studio suspension (migration 0013), studio removal
(A2 #263), `SECURITY.md` for security reports. The operator is not registered yet (#301).

**Missing.** How a studio asks for help, who answers and how fast; a way to see what the studio sees.
Impersonation is listed in `docs/26` section 2 for "after the console exists" and is not built.

**Default.** One support address on the production domain and a WhatsApp business number, both answered by Kris on
Sunday to Thursday, 09:00 to 18:00 Israel time, first answer within one business day; a security or data problem
the same day. No ticketing tool ($0). No impersonation at launch: support reads through the operator console and
asks the owner for screenshots. Impersonation, audited and reason-bound (`docs/20` section 6), when support load
asks for it.

**Acceptance.** The contact is in the console's help menu and in the studio agreement; Kris is registered as
operator (#301).

## 6. Retention

**Exists.** The daily job `tempo-<env>-retention-daily` (`messaging-stack.ts`, tested in
`retention-schedule.test.ts`) deletes, with `RetentionPolicy.Default`: finished invitations after 90 days, inbox
items and announcements after 180, notification requests and deliveries after 90, a replaced health declaration
90 days after its successor. Logs: 90 days in prod config, 14 in dev; infinite retention is refused by
`validateEnvironmentConfig`. Studio removal after 30 days of suspension outside dev (`TEMPO_STUDIO_REMOVAL_MIN_DAYS`).

**Missing.**
- Kris's confirmation of the days (#307), the health declaration rule with the lawyer (#306), the removal wait and
  the deletion promise (#315).
- A rule for `audit.audit_events`: kept forever today. It holds ids and actions; whether a person's erase must also
  reach it is a lawyer question.
- A rule for a member who leaves a studio but is never erased (today they stay until the studio erases them).

**Default.** The days in code stand (#307); audit events kept 7 years (a common accounting period in Israel, **to
verify** with the accountant), then deleted by the same job; inactive members stay until the studio erases them,
and the privacy policy says so. These two additions go into #307 as tasks, not a new issue.

**Acceptance.** #307, #315 closed; the retention table is in the privacy policy (item 9c).

## 7. Billing operations

**Exists.** Phase 3 thin (docs/28): plans, one subscription per studio, entitlements, restricted mode (402
`billing.restricted`, export and the billing page still allowed), the free `pilot` plan. No provider, no webhooks,
no invoices.

**Missing.** Everything that happens around money: the provider (#278, B-1, B-2, B-6), Tempo's own tax invoices or
receipts to studios, refunds and credits, what happens when a payment fails (the trial, grace and restricted
states exist; the reminders do not), the price list.

**Default.** The first paying studio may pay by bank transfer against a receipt from an invoicing service while
#278 is built; the operator moves its subscription to `active` by hand, and each change is audited. Provider and
invoicing service fees are **needs Kris's approval** (per transaction, no fixed fee preferred). The accountant
confirms the invoice type (**to verify**).

**Acceptance.** A written procedure: invoice, payment received, subscription state, refund. One dry run on dev.

## 8. Incidents

**Exists.** `docs/runbooks/restore.md` (a bad write); the canary and the alarms; the audit log for "who did what".

**Missing.** A runbook: what counts as an incident, who decides, who tells the studios, what is written down.
Also the breach step: health declarations put the studio's member data at a higher security level under the Data
Security Regulations (the IAPP summary below lists medical data at the intermediate level), and a serious incident
there is reported to the Privacy Protection Authority. Tempo holds the data for the studio, so the studio must be
told at once; the exact split of duties is **to verify** with the lawyer (item 9d).

**Default.** Three severities: SEV1 (data of one studio reachable by another, or a leak; everyone down), SEV2 (one
function down for many studios), SEV3 (degraded). For SEV1: stop the writes (`restore.md` step 1), keep the
evidence (logs, the audit log, the Neon branch), tell the affected studios the same day, ask the lawyer about the
authority report the same day. Every SEV1 and SEV2 gets a short note in `docs/claude-memory/project-status.md` and an
issue for each fix. Kris is the incident lead; there is no on-call rota.

**Acceptance.** `docs/runbooks/incidents.md` exists; one tabletop exercise (a fictional cross-tenant leak) on dev.

## 9. Privacy

### 9a. Export, erase, deletion

**Done on dev.** Export of a person (`PersonLifecycleEndpoints.cs`, allowed in restricted mode), erase (including
health declarations, notes and tags), merge, a person deleting their own login (`DELETE /me`, migration 0022), the
operator removing a suspended studio and every row it owns (migration 0023). Rows of a removed studio stay in Neon's
history until the window ages out (#315). Missing: a whole-studio export when a studio leaves (only per person
today); default: an operator-run export script before removal.

### 9b. Health form and consents (#306)

Drafts on dev. The lawyer's wording for the health declaration, its retention (H-8) and the consent texts (P-4) is
the first blocker of a real pilot, so it blocks production too.

### 9c. Privacy policy, terms, the studio agreement

**Missing.** No privacy policy, no terms of use, no agreement between Tempo and a studio. The studio decides
why member data is kept; Tempo holds and processes it. The agreement says what Tempo does with the data, the
security it keeps, the sub-processors (AWS in Frankfurt, Neon in Frankfurt, Cloudflare), how a studio gets its data
out, and how fast Tempo reports an incident. Marketing stage C needs the privacy policy on the domain too
(`docs/37` section 2).

### 9d. Israeli law

| Rule | What we verified | What applies to Tempo |
|---|---|---|
| Privacy Protection Law, Amendment 13 | In force since 2025-08-14 (Pearl Cohen; Saymine). Broader definitions, transparency duties, a privacy protection officer in some cases, larger fines, stronger enforcement by the Privacy Protection Authority | **to verify** with the lawyer: whether Tempo or each studio must appoint an officer (sources disagree on thresholds), whether health declarations count as "especially sensitive" data, and whether any registration duty applies |
| Privacy Protection Regulations (Information Security), 5777-2017 | In force since 2018-05-08. Security levels by database; medical data at the intermediate level; serious incidents at the intermediate and high levels reported to the regulator at once (IAPP; Mondaq) | **to verify**: the level of a studio's database with health declarations, the duties that follow (security procedure, risk assessment, periodic audit, penetration testing), and the outsourcing duties when Tempo holds the data |
| Data transfer abroad (AWS and Neon in Frankfurt) | Not verified | **to verify** with the lawyer |

**Default.** Kris books one lawyer session that covers #306, #315, item 9c and this table together (cost is the
lawyer's fee, **needs Kris's approval**). Dev prepares the inputs: the data map (which table holds what), the
retention table (item 6), the sub-processor list, the security controls in item 1.

**Acceptance.** A signed opinion or memo, the policy and terms published, the agreement template ready.

## 10. Load test (#300)

**Exists.** `tools/scripts/booking-load-test.mjs`: 20 fictional members, at most 60 booking requests, sized under
the Neon Free quota; the schema holds under contention (20 parallel bookings for 8 places give 8 booked and 12
waiting). The perf audit of 2026-10-20 and its scripts in `tests/e2e/perf/`; the cold start went from 8.4 s to
about 3.5 s on board #445.

**Missing.** The full test: many studios, many members, the public surface, the worker. It waits for #97 (dev
self sign-up) and must not run on dev's Neon Free quota.

**Default.** Run it on a production-like stage on a Neon branch, sized at Kris's goal of 50 studios with 200 members
each (the ADR-0021 model), before the first paying studio. The concurrency quota (#298) sets the ceiling; record
where 503s start. Neon compute used by the test counts against the plan, so it runs after the Launch decision.

**Acceptance.** Numbers in this runbook: requests per second at p95 under 1 s, where throttling starts, Neon
compute used.

## Before the first paying studio, in order

1. Kris: the lawyer session (#306, #315, item 9c, item 9d) and the accountant (invoices, audit-event retention).
2. Kris: the public repository decision (below).
3. Kris: decide #123 and #303; dev fixes #122.
4. Kris: production account, edge ADR, domain (#299, #304, #241), Lambda quota (#298 or a smaller reservation).
5. Kris: Neon Launch for production, or the `pg_dump` fallback (item 3a); #308 health key copy.
6. Dev: the security review (item 1c) and the $0 scan (item 2, tier 1).
7. Dev: deploy production; confirm the canary email and CI sign-in grants (#302); alarms routed.
8. Dev: restore drill on production (3b); one rebuild of a throwaway stage (3c).
9. Dev: the load test on a production-like stage (#300).
10. Dev: SLO table approved (4b); incident runbook written and rehearsed (8).
11. Kris: support channel live (5); registered as operator (#301).
12. Kris: billing procedure (7); the first studio's agreement signed (9c).
13. Seven green days, then the studio's data goes in.

## Can wait until N studios

| When | What |
|---|---|
| A studio's contract asks, or about 10 studios | The paid penetration test (item 2, tier 2) |
| 10 active studios (tripwire, already built) | Hourly backups (ADR-0021) |
| About 10 studios, or support load | Audited impersonation (item 5); a ticketing tool |
| 10 to 20 studios | GuardDuty in production (about $1 to $3 a month, ADR-0021, **needs Kris's approval**); a second person in the incident path |
| About 65 studios | Cognito past 10,000 monthly active users ($0.015 each, ADR-0021) |
| When asked | Whole-studio export as a self-service screen (item 9a); queue replay tool (3c) |

## The public repository

The repository has been public since 2026-10-15 (D14), so GitHub Actions minutes are free. That was a dev-time
choice. **Before any production launch, the repository is either hardened or made private, and Kris decides
which, at that time.**

- **Hardened** (stays public, $0): #96 done (no personal addresses in files), #97 done, nothing in `docs/`,
  configs or issues that names a production host, account id, Neon endpoint or user pool beyond what a client
  already sees; production values read at deploy time from SSM or GitHub environment secrets; fork PR workflows
  keep needing approval; `SECURITY.md` updated for production.
- **Private**: Actions minutes count against the Free plan's monthly allowance (about 2,000 minutes); recent use was
  about 1,440 in a heavy period (2026-10-15), so it may need a paid plan or fewer runs. **Needs Kris's approval**
  if it bills. Branch protection is then a team rule again, as on Free private repos.

Until Kris decides: no production value goes into the repo, issues or Actions logs.

## Related

- `docs/24_Development_Roadmap.md` section 9, `docs/19_DevOps.md`, `docs/20_Security.md`, `docs/21_Testing.md`
- ADR-0014, ADR-0019, ADR-0021, ADR-0022, ADR-0026, ADR-0027 in `docs/ADR/`
- `docs/runbooks/pilot-readiness.md`, `docs/runbooks/restore.md`, `SECURITY.md`
- Sources for item 9d, read on 2026-10-28:
  - <https://www.pearlcohen.com/israel-significant-amendment-to-the-privacy-law-takes-effect/>
  - <https://advisor.saymine.com/blog-1/israel-enforces-major-privacy-reform-under-amendment-13>
  - <https://iapp.org/news/a/the-new-israeli-data-security-regulations-a-tutorial>
  - <https://www.mondaq.com/data-protection/582376/data-breach-notification-introduced-into-israeli-law>

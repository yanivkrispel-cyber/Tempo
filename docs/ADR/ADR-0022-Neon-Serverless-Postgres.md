# ADR-0022: Neon Serverless Postgres as the Primary Transactional Database

- **Status:** Accepted
- **Date:** 2026-10-14
- **Owners:** Founders, Architecture, Platform Engineering
- **Supersedes:** ADR-0005 (Aurora PostgreSQL Serverless v2); the Aurora DSQL direction in ADR-0021
- **Closes:** ADR-0017 (Lambda networking and NAT cost control)
- **Amends:** ADR-0001, ADR-0006, ADR-0013, ADR-0015, ADR-0019, ADR-0021
- **Related:** ADR-0002, ADR-0012, ADR-0014, ADR-0020

## Context

ADR-0021 sets Tempo's fixed cost to $0 until revenue. Aurora Serverless v2 cannot meet that target, because production needs a minimum capacity. The council's plan was Aurora DSQL, which bills per use. A spike was to confirm it first (council decision Q2).

The spike never ran. From 2026-10-13, `CreateCluster` failed in every Region and in both accounts with "Aurora DSQL can't create the cluster. Contact AWS Support" (support case 179195875300741). DSQL also brought limits that shaped Tempo's design:

- at most 10 schemas per database;
- no Row-Level Security, triggers, PL/pgSQL or extensions;
- one DDL statement per transaction, and DDL never mixed with DML;
- at most 3,000 rows per transaction.

On 2026-10-14 a Neon project in Frankfurt was set up as a stopgap. The migrator, the role bootstrap and the integration tests ran against it without changes, apart from one fix that Aurora also needed (PR #16). The owners then chose Neon as the database for good.

## Decision

1. **Engine.** Tempo's transactional database is Neon serverless Postgres, PostgreSQL 18, in `aws-eu-central-1` (Frankfurt). It runs on AWS, in the same Region as Tempo's Lambda functions, but Neon is the vendor.
2. **Projects.** Each environment has its own Neon project. `tempo-dev` exists. A production project is created before the first production deploy. Branches are for short-lived copies, such as a test run or a migration rehearsal, never for separating environments.
3. **Plan.** Every project starts on the Free plan, which costs $0. Production moves to the Launch plan before the first paying studio, with owner approval (tripwire below).
4. **Network.** There is no VPC. Lambda connects over the public endpoint with TLS, in `VerifyFull` mode. ADR-0017 closes, and its NAT and interface-endpoint costs go away with the VPC.
5. **Endpoints.**
   - The migrator uses the direct endpoint. DDL, session settings and advisory locks need a real session.
   - The API and the Worker use the pooled endpoint, which is the host name with `-pooler`. PgBouncer there runs in transaction mode. Tenant context is set per transaction, with `SET LOCAL` or `set_config(..., true)`, never with a session-level `SET`.
6. **Identities.** Three roles, as in LLD section 12:
   - the Neon owner role (`neondb_owner`), used only to bootstrap roles;
   - `tempo_migrator`, which owns the schemas;
   - `tempo_app`, used at runtime, with least privilege.
7. **Secrets.** Connection details live in SSM Parameter Store as SecureString under `/tempo/<env>/db/`. Standard parameters are free, which Secrets Manager is not. CDK never creates or reads the values. A person writes them, and functions get read access to their own parameters only.
8. **SQL dialect.** Plain PostgreSQL. The DSQL-compatible subset is no longer required. Extensions must be on Neon's supported list.
9. **Tenant isolation.** Structural isolation (council Q6) stays: an immutable `organization_id`, tenant-leading composite keys and foreign keys, and tenant-aware repositories. Row-Level Security is added as a second layer (owner decision 2026-10-14). ADR-0006 item 6 applies again.

## Verified Limits and Prices

Checked on neon.com on 2026-10-14.

| Item | Free plan | Launch plan |
|---|---|---|
| Compute | 100 CU-hours per project per month, autoscaling up to 2 CU | $0.106 per CU-hour |
| Storage | 1 GB per project, 20 GB in total | $0.35 per GB-month |
| Public egress | 5 GB per project | 500 GB included, then $0.10 per GB |
| Restore window | 6 hours | Up to 7 days |
| Minimum fee | None | None; invoices under $0.50 are not collected |
| Scale to zero | After 5 minutes idle, fixed | Configurable |

- **Over a Free limit:** compute is suspended until the next billing period. In production that is an outage.
- **Waking up:** a compute that scaled to zero wakes within a few hundred milliseconds on the first query.
- **Connections:** the pooler accepts up to 10,000 client connections. A 0.25 CU compute allows 104 server connections.

One CU-hour is one compute unit, about 4 GB of RAM, running for one hour. At the 0.25 CU minimum, the free 100 CU-hours cover about 400 awake hours a month. A compute that is awake around the clock uses about 180 CU-hours a month at 0.25 CU. On Launch that is about $19 a month.

## Tripwires (added to ADR-0021)

| Trigger | What happens | Cost |
|---|---|---|
| A production project reaches 70% of any Free limit (CU-hours, storage, egress) | The owners are alerted by email | $0 |
| First paying studio, or the alert above in production | Production moves to Launch, with owner approval | About $3–6 a month while the database is mostly idle; about $19 if it is always awake |
| Production data needs a restore window longer than 6 hours | Launch, which keeps up to 7 days of history | Part of the Launch move |

ADR-0021's 10-studio backup tripwire stays. On Neon it means a longer restore window and a scheduled logical export, not AWS Backup.

## Backup and Recovery (amends ADR-0019)

- **Until the pilot**, recovery relies on Neon's restore window: 6 hours on Free. This is below the 24-hour RPO from council decision Q5. The owners accepted it on 2026-10-14 while there is no customer data.
- **Before the pilot**, the owners decide between two options:
  - a scheduled `pg_dump` to S3;
  - the Launch plan's 7-day window.
- Before high-risk migrations, a Neon branch is taken as a snapshot.
- A restore drill, restoring a branch to a point in time and checking it, runs before the first paying studio.

## Alternatives Considered

| Option | Why not |
|---|---|
| Aurora DSQL | Blocked for the account (support case open since 2026-10-13). Its limits on schemas, RLS and transactions would have shaped the domain model. |
| Aurora Serverless v2 (ADR-0005) | It has a minimum capacity in production, and the network around it costs more: about $65 a month before the first studio (ADR-0021). |
| RDS PostgreSQL, smallest instance | Always-on instance hours, plus a VPC. |
| Supabase or another hosted Postgres | Neon was already working, is in Frankfurt on AWS, and has no minimum fee on its paid plan. |

## Consequences

- Tempo is fully PostgreSQL again: RLS, triggers, PL/pgSQL, extensions and unlimited schemas. The schema-consolidation work planned for DSQL's 10-schema limit is dropped.
- No VPC, no NAT, no interface endpoints, no Secrets Manager. The fixed-cost allowlist in the CDK guard test becomes empty.
- Tempo depends on a vendor outside AWS, a change to ADR-0001. That needs:
  - a data processing agreement before customer data is stored;
  - a check of Neon's status during incidents;
  - an exit path. Neon is standard PostgreSQL, so leaving means `pg_dump` and restore into RDS or Aurora, plus a connection-string change.
- Neon metrics are not in CloudWatch. Usage is read from Neon's API by a scheduled check that alarms in CloudWatch (one of production's ten alarms).
- A cold start adds a few hundred milliseconds to the first request after five idle minutes.

## Review Trigger

Review when:

- a contract requires data to stay within AWS;
- Neon's pricing or Free plan changes materially;
- Neon has a sustained availability problem;
- Tempo grows to the point where Aurora's fixed cost is smaller than Neon's usage cost.

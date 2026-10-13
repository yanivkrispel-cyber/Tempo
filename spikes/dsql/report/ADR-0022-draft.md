# ADR-0022: Aurora DSQL as the Primary Transactional Database

- **Status:** Accepted (spike passed on 2026-10-__; see Appendix A)
- **Date:** 2026-10-__
- **Owners:** Architecture, Platform Engineering
- **Supersedes:** ADR-0005 (Aurora PostgreSQL Serverless v2 stays the exit path)
- **Related:** ADR-0006, ADR-0008, ADR-0013, ADR-0015, ADR-0017, ADR-0019, ADR-0021

## Context

ADR-0021 sets the fixed cost to zero until revenue. Aurora Serverless v2 cannot meet that in production. ADR-0005 requires auto-pause off and at least 0.5 ACU there, which is $51.10 a month before the first studio. It also needs a VPC, so the Lambdas need either endpoints or a NAT gateway (ADR-0017).

Aurora DSQL is serverless PostgreSQL-compatible storage with no minimum charge. It has no VPC requirement and uses IAM authentication. Prices for `eu-central-1` were verified with the Price List API on 2026-10-10:

| Item | Price |
|---|---|
| Compute | $9.50 per million DPU |
| Storage | $0.45 per GB-month |
| Always Free, every month | 100,000 DPU and 1 GB-month |

## Decision

Use one single-Region Aurora DSQL cluster per environment as the system of record.

### Connection and identity

- Authentication uses IAM tokens through the `Amazon.AuroraDsql.Npgsql` connector. No database passwords and no secrets exist.
- Each function's IAM role maps to one database role:
  - The migrator's IAM role maps to `tempo_migrator`.
  - The API and worker IAM roles map to `tempo_app`.
  - The mapping uses `AWS IAM GRANT`.
- Only a one-time bootstrap uses the `admin` role. The bootstrap:
  - creates the roles and the IAM mappings;
  - creates the schemas, owned by `tempo_migrator`.
- The database is `postgres`. DSQL has exactly one database per cluster.

### Portable SQL

All application SQL and migrations run unchanged on PostgreSQL 17 and on DSQL. Local development and CI use PostgreSQL 17 in Testcontainers. A nightly job runs the migrations and the compatibility suite against the development cluster. The allowed subset comes from the spike probe (Appendix A). In short:

(fill from results)

### Migrations

- DbUp with a Tempo journal table `platform.schema_versions`, keyed by script name. DbUp's default journal uses `serial`, which DSQL rejects without an explicit CACHE.
- Scripts run without a wrapping transaction. DSQL allows one DDL per transaction, and does not allow DDL and DML in the same transaction.
- One DDL statement per script, and every DDL is idempotent (`IF NOT EXISTS`).
- Indexes use the DbUp variable `$async$`, which is `ASYNC` on DSQL and empty on PostgreSQL. The migrator waits for index jobs before it reports success.

### Concurrency

DSQL uses optimistic concurrency. Conflicts surface at commit as SQLSTATE `40001` (OC000 for data, OC001 for schema). Every write transaction is idempotent and retried with backoff.

- **Capacity:** a conditional `UPDATE ... SET booked_count = booked_count + 1 WHERE ... AND booked_count < capacity` runs in the same transaction as the booking `INSERT`.
- **Resource overlap** (room or instructor): the transaction first runs `SELECT ... FOR UPDATE` on the resource row, then an overlap query. This replaces `EXCLUDE` constraints, which need the `btree_gist` extension.

### Tenant isolation

DSQL has no Row-Level Security. ADR-0006 is amended so that isolation is structural:

- `organization_id` is the leading column of every tenant table's primary key and of every foreign key between tenant tables.
- Every data access goes through a repository that requires the tenant context.
- An architecture test rejects any query on a tenant table that does not filter by `organization_id`.

### Schemas

DSQL allows (measured value) schemas per database. LLD §10.5 plans twelve schemas from day one, plus one for each vertical. Module ownership therefore moves from one schema per module to (decision on consolidation).

## Exit path

If a tripwire in ADR-0021 requires RLS, extensions, PITR or Aurora's ecosystem, move to Aurora PostgreSQL. Because the SQL is portable, the move is a data copy plus an infrastructure change, not a rewrite. The trigger is recorded in ADR-0021.

## Consequences

(fill)

## Appendix A: spike results

(fill)

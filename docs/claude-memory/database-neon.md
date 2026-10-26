# Database: Neon

ADR-0022 is the source of truth. This file holds the operational facts.

## Project

| Item | Value |
|---|---|
| Neon org | `org-morning-hill-61301499` (owner: the project owner; members are invited from the Neon console) |
| Project | `wild-darkness-22822656` ("tempo-dev"), region `aws-eu-central-1`, PostgreSQL 18 |
| Main branch | `production` (`br-square-pond-b9hfpgob`), database `neondb` |
| Owner role | `neondb_owner`: CREATEROLE, not superuser |
| Plan | Free: 100 CU-hours a month, 1 GB storage, 5 GB egress, 6-hour restore window. Going over suspends compute until the next billing period. |

## Branch per developer

- Each developer works against their own Neon branch, created from `production` (`dev-<name>`). Branches are free
  and copy-on-write, so one developer's migration never breaks the other's database.
- The `production` branch changes only through the migrator run by CI or by an announced manual deploy.
- Delete your branch when it is no longer needed; it counts toward the project's storage.

## Secrets (SSM Parameter Store, account 687239340846, eu-central-1)

- `/tempo/<env>/db/neon-connection-string`: the direct endpoint, URI form.
- `/tempo/<env>/db/app-password`, `/tempo/<env>/db/platform-password` and `/tempo/<env>/db/migrator-password`: fixed
  role passwords. The migrator fails if any is missing, so `platform-password` must exist before migration 0002
  deploys to an environment.
- `/tempo/<env>/neon/api-key`: used by the usage-check Lambda.

A human writes these values. Claude prepares the command and hands it over.

The three role passwords are at least 32 characters, letters and digits only (#97); rotate any shorter one. Checked
on 2026-10-25 by length only: all three dev passwords are 48.

## Migrator

- Runs as a Lambda without a VPC and reads the SSM parameters above. Locally it takes `DATABASE_URL`.
- Its journal is `platform.schema_versions`. A rerun applies nothing new.
- Scripts name runtime roles through DbUp variables, `$app_role$` and `$platform_role$`, never literally, so tests can
  use their own role names. DbUp substitutes any `$word$`, so a dollar-quoted body uses plain `$$`, never `$tag$`.
- RLS is enabled, not forced: the migrator owns every table and is exempt, which the `SECURITY DEFINER` lookups rely
  on. Runtime roles own nothing, so RLS always applies to them. Tests: `tests/Tempo.IntegrationTests/DatabaseMigrator/
  IdentitySchemaTests.cs`.
- A non-superuser master needs `GRANT migrator TO CURRENT_USER WITH INHERIT FALSE, SET TRUE` (fixed in PR #16).
- DbUp runs every script in **one transaction** (`.WithTransaction()` in `MigrationRunner.cs`), so a script can't
  `CREATE INDEX CONCURRENTLY`, and a plain `CREATE INDEX` blocks writes to its table while it builds. Fine on dev; on a
  database with history (production), build a new index on a busy table by hand first, as the migrator role:
  `CREATE INDEX CONCURRENTLY` with the script's exact definition, then check `pg_index.indisvalid` (a failed
  concurrent build leaves an invalid index: drop it and build again). The script says `IF NOT EXISTS`, so the migrator
  then skips it and journals the script. 0039 (`ix_bookings_person_attended`, #516) is the first such index; its test
  is `RunAsync_After0039sIndexWasBuiltConcurrentlyByHand_SkipsItAndJournalsTheScript`.
- Usage check: the `tempo-<env>-neon-usage` Lambda runs every 6 hours and publishes
  `Tempo/Database NeonFreeLimitPercent`; the prod alarm fires at 70%. Dev has no alarm (alarm budget), so since
  2026-10-25 (#97) the function itself emails the owner through the dev canary's SNS topic once per Neon billing
  period at 70%; the period it last warned about is in `/tempo/dev/neon/usage-warning`. Dev was at 19% on 2026-10-25.
  Test the email path without waiting for 70%: invoke the function with `{"mode":"selftest"}` (one email marked
  "[self-test]", the state untouched). The function uses about 120 MB on a plain run, so it has 256 MB (2026-10-25).

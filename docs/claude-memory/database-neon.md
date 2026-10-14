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
- `/tempo/<env>/db/app-password` and `/tempo/<env>/db/migrator-password`: fixed role passwords.
- `/tempo/<env>/neon/api-key`: used by the usage-check Lambda.

A human writes these values. Claude prepares the command and hands it over.

## Migrator

- Runs as a Lambda without a VPC and reads the SSM parameters above. Locally it takes `DATABASE_URL`.
- Its journal is `platform.schema_versions`. A rerun applies nothing new.
- A non-superuser master needs `GRANT migrator TO CURRENT_USER WITH INHERIT FALSE, SET TRUE` (fixed in PR #16).
- Usage check: the `tempo-<env>-neon-usage` Lambda runs every 6 hours and publishes
  `Tempo/Database NeonFreeLimitPercent`; the prod alarm fires at 70%.

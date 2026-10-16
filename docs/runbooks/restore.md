# Runbook: restoring the database (Neon point-in-time restore)

Written on the night of 2026-10-15 (board #136, B2) after the first restore drill on dev. docs/01 section 28 asks
for a drill before the first paying studio; this is it, and the way to repeat it.

## What the drill showed (dev, 2026-10-15, 22:4x Israel time)

| Measure | Result |
|---|---|
| Restore window (history retention) | **6 hours** on the Free plan (`history_retention_seconds` = 21600); up to 7 days on Launch |
| Time to a branch 30 minutes back, with a read-only endpoint | **4.1 s** |
| Migrations on the restored branch | the same 10 as main (`platform.schema_versions`) |
| Row counts | identical except the rows written after the restore point (invitations, people, audit events) |
| Whole drill, branch deleted at the end | 12.4 s |

So the RPO on Free is "any point in the last 6 hours", and the RTO of the database step itself is seconds. What
takes longer is deciding, and pointing the environment at the restored branch (below).

## Repeating the drill

```text
node tools/scripts/neon-restore-drill.mjs --environment dev [--minutes-ago 30] [--profile tempo]
```

Needs `ssm:GetParameter` on `/tempo/<env>/neon/api-key` (the parameter the usage-check Lambda reads). The script
creates `restore-drill-<timestamp>` from the main branch as of that moment, compares the migration journal and the
row counts of the tenant tables with main over Neon's SQL-over-HTTP endpoint, and deletes the branch. `--keep`
leaves it for a look in the Neon console (it counts toward the project's storage; delete it after). Nothing on the
main branch changes, and no connection string or key is printed.

Run it once a month, and before every plan change on Neon; put the numbers in the table above.

## A real restore

A restore in Neon is a **branch from the past**; the main branch is never rewound in place. Steps, as the owner:

1. **Stop the writes.** Dev: nothing to do beyond telling the board. Prod (later): suspend the API through
   the restricted-mode switch or scale the function's reserved concurrency to 0, so no new rows land on the bad
   state.
2. **Pick the point.** Find the moment before the damage from the audit log (`audit.audit_events`, every write has
   one) or the deploy run time. It must be inside the window (6 hours on Free).
3. **Branch from it.** Neon console, Branches, "Restore" on `production`, or
   `node tools/scripts/neon-restore-drill.mjs --minutes-ago <n> --keep`. Give the branch a read-write endpoint.
4. **Check it.** The drill's checks (journal, counts), then a look at the rows that matter for the incident.
5. **Switch the environment to it.** The runtime reads the connection through SSM
   (`/tempo/<env>/db/neon-connection-string`, docs/claude-memory/database-neon.md) and the role passwords stay the
   same on a branch (Neon copies roles). Write the new branch's direct endpoint URI into the parameter (a human
   writes secrets), then redeploy or wait for the next cold start of the API, worker and migrator functions.
6. **Make it the default.** In the Neon console set the restored branch as the project's default and rename the
   old `production` to `production-before-<date>`; delete it once nobody needs it (storage).
7. **Write it down.** An incident note in `docs/claude-memory/project-status.md` with the restore point, what was
   lost (the rows after it), and why.

Rows written after the restore point are gone; the audit log on the old branch still has them, which is why the old
branch is renamed and kept for a while rather than deleted.

## Beyond the window

- The 10-studio tripwire (ADR-0021, docs/26 section 10.2) emails the owner to move to hourly backups; on Neon that
  means the Launch plan (7-day window) or a scheduled `pg_dump` to S3 (a Lambda inside the free tier, part two of
  this runbook when the first paying studio arrives).
- Neon's own storage is replicated inside the region; a region loss is outside this runbook.

## Related

- `docs/01_AWS_Infrastructure_LLD.md` section 28 (backup and recovery), ADR-0022 (Neon), ADR-0021 (tripwire)
- `docs/claude-memory/database-neon.md` (project ids, parameters, branch per developer)
- `tools/scripts/neon-restore-drill.mjs`

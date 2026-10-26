-- A member's attended visits (board #511, K4 / S-5). On a big studio's database (1,500 members, 60 classes a week, a
-- year of history; tests/e2e/perf/big-db-2026-10-25.md) the owner's "members at risk" report was the only screen query
-- over 20 ms (23 ms): its "attended in the last 30 days" check scanned every booking of the studio, and its "last
-- visit" per member filtered each member's bookings by status. With this partial index both read only attended rows,
-- by member, without touching the table (15 ms on the same data). It grows with the history, so it only gets worse
-- without it. Attended rows are written once per visit, so the write cost is small. 0038 is the cancel time's (#429).
-- IF NOT EXISTS: DbUp runs every script in one transaction, so this can't be CONCURRENTLY. On a database with history
-- (production), build it by hand first with CREATE INDEX CONCURRENTLY and the same definition; this script then skips
-- it (docs/claude-memory/database-neon.md, "Migrator").
CREATE INDEX IF NOT EXISTS ix_bookings_person_attended ON scheduling.bookings (organization_id, person_id)
    INCLUDE (session_id)
    WHERE status = 'attended';

-- Abuse limit for invitations and join links (docs/26 section 10.3): at most
-- 20 preview or accept attempts per account per hour, counted in PostgreSQL
-- (no Redis, ADR-0013). Rows older than a day are deleted as new ones arrive.
-- Not tenant-owned: an attempt happens before any studio is known.

CREATE TABLE identity.join_attempts (
    user_account_id uuid NOT NULL REFERENCES identity.user_accounts (id),
    attempted_at    timestamptz NOT NULL
);
CREATE INDEX ix_join_attempts_account_time ON identity.join_attempts (user_account_id, attempted_at DESC);

GRANT SELECT, INSERT, DELETE ON identity.join_attempts TO $app_role$;

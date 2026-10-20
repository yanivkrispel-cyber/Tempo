-- Per-client rate limits (board #404, S-A, K4): a fixed-window counter per bucket (what is limited, like
-- `public.join.ip`) and client, shared by every Lambda instance. The client is a SHA-256 of its source address or
-- its account id, never the address itself; rows older than a day are deleted by the API as it counts. Not tenant
-- data, so no row-level security, like identity.join_attempts.
CREATE TABLE identity.rate_counters (
    bucket       text NOT NULL CHECK (bucket ~ '^[a-z][a-z_.]{0,39}$'),
    client_key   bytea NOT NULL CHECK (length(client_key) = 32),
    window_start timestamptz NOT NULL,
    hits         int NOT NULL CHECK (hits > 0),
    PRIMARY KEY (bucket, client_key, window_start)
);
CREATE INDEX ix_rate_counters_window ON identity.rate_counters (window_start);

GRANT SELECT, INSERT, UPDATE, DELETE ON identity.rate_counters TO $app_role$;

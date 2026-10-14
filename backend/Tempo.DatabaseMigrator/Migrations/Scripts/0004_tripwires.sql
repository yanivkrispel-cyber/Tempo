-- One-shot platform alerts (docs/26 section 10.2). A row records that a
-- tripwire fired, so the daily check alerts the owner once, not every day.

CREATE TABLE platform_admin.tripwires (
    name     text PRIMARY KEY,
    fired_at timestamptz NOT NULL,
    value    integer NOT NULL
);

GRANT SELECT, INSERT ON platform_admin.tripwires TO $platform_role$;

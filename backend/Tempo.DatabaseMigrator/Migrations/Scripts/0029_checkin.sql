-- Check-in at the door (docs/33_Studio_Experience_LLD.md section 8, D19, step E5). Each person gets a 32-byte
-- secret on first use; the member's app shows a code derived from it that changes every 30 seconds (HOTP), and staff
-- scan it. Erase clears the secret. Invalid scans are counted per staff member, five a minute at most.
ALTER TABLE people.people ADD COLUMN checkin_secret bytea CHECK (checkin_secret IS NULL OR length(checkin_secret) = 32);

CREATE TABLE people.checkin_attempts (
    organization_id uuid NOT NULL,
    membership_id   uuid NOT NULL,
    attempted_at    timestamptz NOT NULL,
    FOREIGN KEY (organization_id, membership_id) REFERENCES organizations.memberships (organization_id, id)
);
CREATE INDEX ix_checkin_attempts_member_time ON people.checkin_attempts (organization_id, membership_id, attempted_at DESC);

ALTER TABLE people.checkin_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY checkin_attempts_app ON people.checkin_attempts TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON people.checkin_attempts TO $app_role$;

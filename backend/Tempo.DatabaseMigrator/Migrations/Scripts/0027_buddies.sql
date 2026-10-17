-- Buddies (docs/33_Studio_Experience_LLD.md section 4, D18, step E3). Two members of a studio see each other on the
-- room map only after both agreed: one shares a one-time code, the other enters it. The code is stored as its
-- SHA-256 only and lives 48 hours. A pair is one row (the smaller person id first). Wrong codes are counted per
-- person so guessing is rate-limited (5 an hour). Erase deletes all three kinds of rows for the person.
CREATE TABLE people.buddy_codes (
    organization_id uuid NOT NULL,
    person_id       uuid NOT NULL,
    code_hash       bytea NOT NULL,
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE UNIQUE INDEX ux_buddy_codes_hash ON people.buddy_codes (organization_id, code_hash);

CREATE TABLE people.buddy_links (
    organization_id uuid NOT NULL,
    person_low      uuid NOT NULL,
    person_high     uuid NOT NULL,
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_low, person_high),
    CHECK (person_low < person_high),
    FOREIGN KEY (organization_id, person_low) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, person_high) REFERENCES people.people (organization_id, id)
);
CREATE INDEX ix_buddy_links_high ON people.buddy_links (organization_id, person_high);

CREATE TABLE people.buddy_attempts (
    organization_id uuid NOT NULL,
    person_id       uuid NOT NULL,
    attempted_at    timestamptz NOT NULL,
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE INDEX ix_buddy_attempts_person_time ON people.buddy_attempts (organization_id, person_id, attempted_at DESC);

ALTER TABLE people.buddy_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY buddy_codes_app ON people.buddy_codes TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

ALTER TABLE people.buddy_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY buddy_links_app ON people.buddy_links TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

ALTER TABLE people.buddy_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY buddy_attempts_app ON people.buddy_attempts TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.buddy_codes TO $app_role$;   -- a new code replaces the old one
GRANT SELECT, INSERT, DELETE ON people.buddy_links, people.buddy_attempts TO $app_role$;

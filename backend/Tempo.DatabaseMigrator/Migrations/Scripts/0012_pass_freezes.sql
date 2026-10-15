-- Freezing a period membership (docs/29 section 16.4, night board #136, A5): a date range during which the
-- membership cannot book. Its validity (passes.ends_on) is extended by the same number of days when the
-- freeze is created and shortened back when a freeze that has not started yet is removed, so ends_on
-- stays the single truth for validity.

CREATE TABLE scheduling.pass_freezes (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    pass_id          uuid NOT NULL,
    starts_on        date NOT NULL,
    ends_on          date NOT NULL,
    created_by       uuid NOT NULL,                       -- the staff membership
    created_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, pass_id) REFERENCES scheduling.passes (organization_id, id),
    FOREIGN KEY (organization_id, created_by) REFERENCES organizations.memberships (organization_id, id),
    CHECK (ends_on >= starts_on AND ends_on - starts_on < 90)
);
CREATE INDEX ix_pass_freezes_pass ON scheduling.pass_freezes (organization_id, pass_id, starts_on);

ALTER TABLE scheduling.pass_freezes ENABLE ROW LEVEL SECURITY;
CREATE POLICY pass_freezes_app ON scheduling.pass_freezes TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY pass_freezes_platform ON scheduling.pass_freezes TO $platform_role$ USING (true);

GRANT SELECT, INSERT, DELETE ON scheduling.pass_freezes TO $app_role$;
GRANT SELECT ON scheduling.pass_freezes TO $platform_role$;

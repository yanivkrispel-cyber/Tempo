-- Member progress (docs/31_Health_Declaration_LLD.md section 12, G-1 to G-3; day board #232, P1).
-- A member's own monthly goal per studio; no row means no goal, and clearing the goal deletes the row. Visits and
-- the streak are computed from attended bookings, so nothing else is stored. Erase and merge delete the row.
CREATE TABLE scheduling.member_goals (
    organization_id  uuid NOT NULL,
    person_id        uuid NOT NULL,
    monthly_goal     smallint NOT NULL CHECK (monthly_goal BETWEEN 1 AND 31),
    updated_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);

ALTER TABLE scheduling.member_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_goals_app ON scheduling.member_goals TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.member_goals TO $app_role$;

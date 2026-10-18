-- Check-in scan limits (#345, H-2 on board #347). Every scan by staff is recorded before the code is checked and
-- forgotten when the code proves valid, so what stays are the invalid ones. Each row now has its own id (the API
-- deletes exactly the row it wrote) and the person the code claims to be, so invalid scans are also capped per
-- person across every scanner. The person id is not a foreign key: a made-up code can name anyone.
ALTER TABLE people.checkin_attempts ADD COLUMN id uuid NOT NULL DEFAULT uuidv7();
ALTER TABLE people.checkin_attempts ADD PRIMARY KEY (organization_id, id);
ALTER TABLE people.checkin_attempts ADD COLUMN target_person_id uuid;
CREATE INDEX ix_checkin_attempts_target_time ON people.checkin_attempts (organization_id, target_person_id, attempted_at DESC)
    WHERE target_person_id IS NOT NULL;

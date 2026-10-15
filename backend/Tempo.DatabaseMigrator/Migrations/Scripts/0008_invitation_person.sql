-- An invitation may carry the person record it is for (docs/27 section 4.5):
-- staff recorded a walk-in, then invite them to the app. Accepting it links the
-- login to that record instead of creating a second one.

ALTER TABLE organizations.invitations ADD COLUMN person_id uuid;
ALTER TABLE organizations.invitations
    ADD CONSTRAINT invitations_person_fkey FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id);

-- The lookup returns SETOF organizations.invitations; recreate it so its row type
-- carries the new column.
CREATE OR REPLACE FUNCTION organizations.find_invitation_by_token_hash(token_hash bytea)
RETURNS SETOF organizations.invitations
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT i.* FROM organizations.invitations i WHERE i.token_hash = find_invitation_by_token_hash.token_hash
$$;

-- The health declaration (docs/31_Health_Declaration_LLD.md section 6; day board #232, H2).
-- Answers, the signed name and the guardian's name are AES-256-GCM ciphertext written by the application
-- (ADR-0026); no column here holds them in plain text. `has_yes` is derived at signing so the status can be read
-- without the key. One current declaration per person; a replaced one keeps `superseded_at` and is deleted by the
-- retention job 90 days later (H-8). Erase deletes every row of the person.
CREATE TABLE people.health_declarations (
    organization_id           uuid NOT NULL,
    id                        uuid NOT NULL,
    person_id                 uuid NOT NULL,
    form_version              int NOT NULL CHECK (form_version >= 1),
    signer_role               text NOT NULL CHECK (signer_role IN ('self', 'guardian')),
    has_yes                   boolean NOT NULL,
    signed_at                 timestamptz NOT NULL,
    expires_at                timestamptz NOT NULL,
    key_version               int NOT NULL CHECK (key_version >= 1),
    answers_ciphertext        bytea NOT NULL,
    signed_name_ciphertext    bytea NOT NULL,
    guardian_name_ciphertext  bytea,
    medical_approval_on       date,
    medical_approval_by       uuid,
    superseded_at             timestamptz,
    created_at                timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, medical_approval_by) REFERENCES organizations.memberships (organization_id, id),
    CHECK (expires_at > signed_at),
    CHECK ((signer_role = 'guardian') = (guardian_name_ciphertext IS NOT NULL)),
    CHECK ((medical_approval_on IS NULL) = (medical_approval_by IS NULL))
);
CREATE UNIQUE INDEX ux_health_declarations_current ON people.health_declarations (organization_id, person_id)
    WHERE superseded_at IS NULL;
CREATE INDEX ix_health_declarations_superseded ON people.health_declarations (superseded_at)
    WHERE superseded_at IS NOT NULL;

ALTER TABLE people.health_declarations ENABLE ROW LEVEL SECURITY;
CREATE POLICY health_declarations_app ON people.health_declarations TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY health_declarations_platform ON people.health_declarations TO $platform_role$ USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.health_declarations TO $app_role$;   -- delete: erase only
GRANT SELECT, DELETE ON people.health_declarations TO $platform_role$;               -- the retention job (H-8)

-- The booking gate (H-5), off by default, on the existing booking policy.
ALTER TABLE scheduling.booking_policies ADD COLUMN require_health_declaration boolean NOT NULL DEFAULT false;

-- health.view (H-4): the owner role only; admins and staff see the status through people.view.
INSERT INTO authz.role_permissions (role_id, permission_key)
VALUES ('00000000-0000-7000-8000-000000000001'::uuid, 'health.view');

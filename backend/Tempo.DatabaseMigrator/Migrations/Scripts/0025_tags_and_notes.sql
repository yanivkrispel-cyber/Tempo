-- Staff notes and tags on a person (docs/34 sections 7, 8 and 10, N-1 to N-7, day board #321).
-- RLS like the other people tables, with no self clause: a member never reads tags or notes through RLS.

CREATE TABLE people.tags (
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    id              uuid NOT NULL,
    name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
    color           smallint NOT NULL CHECK (color BETWEEN 1 AND 6),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX ux_tags_name ON people.tags (organization_id, lower(name));

CREATE TABLE people.person_tags (
    organization_id uuid NOT NULL,
    person_id       uuid NOT NULL,
    tag_id          uuid NOT NULL,
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id, tag_id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, tag_id) REFERENCES people.tags (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_person_tags_tag ON people.person_tags (organization_id, tag_id);

CREATE TABLE people.person_notes (
    organization_id      uuid NOT NULL,
    id                   uuid NOT NULL,
    person_id            uuid NOT NULL,
    author_membership_id uuid,
    author_role          text NOT NULL CHECK (author_role IN ('owner', 'admin', 'staff')),
    body                 text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    created_at           timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, author_membership_id) REFERENCES organizations.memberships (organization_id, id)
        ON DELETE SET NULL (author_membership_id)
);
CREATE INDEX ix_person_notes_person ON people.person_notes (organization_id, person_id, id DESC);

ALTER TABLE people.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tags_app ON people.tags TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY person_tags_app ON people.person_tags TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY person_notes_app ON people.person_notes TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY tags_platform ON people.tags TO $platform_role$ USING (true);
CREATE POLICY person_tags_platform ON people.person_tags TO $platform_role$ USING (true);
CREATE POLICY person_notes_platform ON people.person_notes TO $platform_role$ USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON people.tags, people.person_tags, people.person_notes TO $app_role$;
GRANT SELECT ON people.tags, people.person_tags, people.person_notes TO $platform_role$;

-- The permissions (docs/34 section 3): tags.manage for owner and admin; notes.view and notes.manage for owner, admin
-- and staff; notes.moderate for owner and admin.
INSERT INTO authz.role_permissions (role_id, permission_key) VALUES
    ('00000000-0000-7000-8000-000000000001'::uuid, 'people.tags.manage'),
    ('00000000-0000-7000-8000-000000000002'::uuid, 'people.tags.manage'),
    ('00000000-0000-7000-8000-000000000001'::uuid, 'people.notes.view'),
    ('00000000-0000-7000-8000-000000000002'::uuid, 'people.notes.view'),
    ('00000000-0000-7000-8000-000000000003'::uuid, 'people.notes.view'),
    ('00000000-0000-7000-8000-000000000001'::uuid, 'people.notes.manage'),
    ('00000000-0000-7000-8000-000000000002'::uuid, 'people.notes.manage'),
    ('00000000-0000-7000-8000-000000000003'::uuid, 'people.notes.manage'),
    ('00000000-0000-7000-8000-000000000001'::uuid, 'people.notes.moderate'),
    ('00000000-0000-7000-8000-000000000002'::uuid, 'people.notes.moderate');

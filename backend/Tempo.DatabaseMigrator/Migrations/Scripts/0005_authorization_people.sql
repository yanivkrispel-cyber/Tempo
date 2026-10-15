-- Phase 2: permissions, roles, role assignments, owner transfer and person
-- records (docs/27_Authorization_and_People_LLD.md section 5).
--
-- Same conventions as 0002: the migrator owns every object, runtime roles come
-- from $app_role$ and $platform_role$, row-level security is enabled (not
-- forced) and reads the tenant from app.organization_id and the caller from
-- app.user_account_id.
--
-- The four system roles have fixed ids, so the one-owner index can name the
-- owner role and code can refer to the roles without a lookup.
--   owner  00000000-0000-7000-8000-000000000001
--   admin  00000000-0000-7000-8000-000000000002
--   staff  00000000-0000-7000-8000-000000000003
--   client 00000000-0000-7000-8000-000000000004

CREATE SCHEMA authz;    -- not "authorization", which is an SQL keyword
CREATE SCHEMA people;

-- authz ------------------------------------------------------------------

CREATE TABLE authz.roles (
    id              uuid PRIMARY KEY,
    organization_id uuid REFERENCES organizations.organizations (id),   -- NULL = system role
    key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
    display_name    text NOT NULL,
    is_system       boolean NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    CHECK (is_system = (organization_id IS NULL))
);
CREATE UNIQUE INDEX ux_roles_key ON authz.roles (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'), key);

CREATE TABLE authz.role_permissions (
    role_id        uuid NOT NULL REFERENCES authz.roles (id),
    permission_key text NOT NULL CHECK (permission_key ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE authz.role_assignments (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    membership_id   uuid NOT NULL,
    role_id         uuid NOT NULL REFERENCES authz.roles (id),
    scope_type      text NOT NULL DEFAULT 'organization' CHECK (scope_type IN ('organization')),
    scope_id        uuid,
    status          text NOT NULL CHECK (status IN ('active', 'revoked')),
    granted_by      uuid,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, membership_id) REFERENCES organizations.memberships (organization_id, id)
);
CREATE UNIQUE INDEX ux_role_assignments_live ON authz.role_assignments (organization_id, membership_id, role_id)
    WHERE status = 'active';
CREATE UNIQUE INDEX ux_role_assignments_one_owner ON authz.role_assignments (organization_id)
    WHERE role_id = '00000000-0000-7000-8000-000000000001' AND status = 'active';
CREATE INDEX ix_role_assignments_membership ON authz.role_assignments (organization_id, membership_id)
    WHERE status = 'active';

CREATE TABLE organizations.ownership_transfers (
    organization_id    uuid NOT NULL REFERENCES organizations.organizations (id),
    id                 uuid NOT NULL,
    from_membership_id uuid NOT NULL,
    to_membership_id   uuid NOT NULL,
    status             text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
    expires_at         timestamptz NOT NULL,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    version            bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, from_membership_id) REFERENCES organizations.memberships (organization_id, id),
    FOREIGN KEY (organization_id, to_membership_id) REFERENCES organizations.memberships (organization_id, id),
    CHECK (from_membership_id <> to_membership_id)
);
CREATE UNIQUE INDEX ux_ownership_transfers_one_pending ON organizations.ownership_transfers (organization_id)
    WHERE status = 'pending';

-- people -----------------------------------------------------------------

CREATE TABLE people.people (
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    id              uuid NOT NULL,
    given_name      text,
    family_name     text,
    display_name    text NOT NULL,
    birth_date      date,
    status          text NOT NULL CHECK (status IN ('active', 'archived', 'anonymized', 'merged')),
    merged_into_id  uuid,
    user_account_id uuid REFERENCES identity.user_accounts (id),
    membership_id   uuid,
    source          text NOT NULL CHECK (source IN ('organization_created', 'join_link', 'invitation', 'staff_created', 'import')),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, membership_id) REFERENCES organizations.memberships (organization_id, id),
    FOREIGN KEY (organization_id, merged_into_id) REFERENCES people.people (organization_id, id),
    CHECK ((status = 'merged') = (merged_into_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_people_login ON people.people (organization_id, user_account_id) WHERE user_account_id IS NOT NULL;
CREATE UNIQUE INDEX ux_people_membership ON people.people (organization_id, membership_id) WHERE membership_id IS NOT NULL;
CREATE INDEX ix_people_user ON people.people (user_account_id) WHERE user_account_id IS NOT NULL;
CREATE INDEX ix_people_name ON people.people (organization_id, lower(display_name));

CREATE TABLE people.contact_points (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    person_id       uuid NOT NULL,
    type            text NOT NULL CHECK (type IN ('email', 'phone')),
    value           text NOT NULL,          -- email lowercased, phone E.164
    is_primary      boolean NOT NULL,
    verified        boolean NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    CHECK (type <> 'phone' OR value ~ '^\+[1-9][0-9]{6,14}$'),
    CHECK (type <> 'email' OR value = lower(value))
);
CREATE INDEX ix_contact_points_value ON people.contact_points (organization_id, type, value);
CREATE INDEX ix_contact_points_person ON people.contact_points (organization_id, person_id);
CREATE UNIQUE INDEX ux_contact_points_one_primary ON people.contact_points (organization_id, person_id, type)
    WHERE is_primary;

CREATE TABLE people.consents (          -- append-only
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    person_id       uuid NOT NULL,
    purpose         text NOT NULL CHECK (purpose IN ('marketing', 'reminders')),
    channel         text NOT NULL CHECK (channel IN ('email', 'push', 'whatsapp')),
    state           text NOT NULL CHECK (state IN ('granted', 'withdrawn')),
    method          text NOT NULL CHECK (method IN ('self', 'staff_on_behalf', 'import')),
    text_version    text NOT NULL,
    recorded_by     uuid,
    occurred_at     timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE INDEX ix_consents_person ON people.consents (organization_id, person_id, purpose, channel, occurred_at DESC);

CREATE TABLE people.person_relationships (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    from_person_id  uuid NOT NULL,
    to_person_id    uuid NOT NULL,
    type            text NOT NULL CHECK (type IN ('guardian_of', 'emergency_contact_for')),
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, from_person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, to_person_id) REFERENCES people.people (organization_id, id),
    CHECK (from_person_id <> to_person_id)
);
CREATE UNIQUE INDEX ux_person_relationships ON people.person_relationships (organization_id, from_person_id, to_person_id, type);

CREATE TABLE people.duplicate_candidates (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    person_a_id     uuid NOT NULL,
    person_b_id     uuid NOT NULL,
    reason          text NOT NULL CHECK (reason IN ('email', 'phone', 'name_birth_date')),
    status          text NOT NULL CHECK (status IN ('open', 'merged', 'not_duplicate')),
    resolved_by     uuid,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_a_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, person_b_id) REFERENCES people.people (organization_id, id),
    CHECK (person_a_id < person_b_id)
);
CREATE UNIQUE INDEX ux_duplicate_candidates_pair ON people.duplicate_candidates (organization_id, person_a_id, person_b_id);

-- system roles (docs/27 section 3.2) -------------------------------------

INSERT INTO authz.roles (id, organization_id, key, display_name, is_system, created_at, updated_at) VALUES
    ('00000000-0000-7000-8000-000000000001', NULL, 'owner',  'בעלים',  true, now(), now()),
    ('00000000-0000-7000-8000-000000000002', NULL, 'admin',  'מנהל',   true, now(), now()),
    ('00000000-0000-7000-8000-000000000003', NULL, 'staff',  'צוות',   true, now(), now()),
    ('00000000-0000-7000-8000-000000000004', NULL, 'client', 'מתאמן',  true, now(), now());

-- The Phase 1 matrix, as permissions (docs/27 section 3.1).
INSERT INTO authz.role_permissions (role_id, permission_key)
SELECT '00000000-0000-7000-8000-000000000001'::uuid, key
FROM unnest(ARRAY[
    'organization.view', 'organization.settings.manage', 'members.view', 'members.invite.staff',
    'members.invite.admin', 'members.manage', 'roles.manage', 'audit.view', 'people.view', 'people.manage',
    'people.merge', 'people.export', 'people.erase', 'consent.manage', 'ownership.transfer'
]) AS key
UNION ALL
SELECT '00000000-0000-7000-8000-000000000002'::uuid, key
FROM unnest(ARRAY[
    'organization.view', 'organization.settings.manage', 'members.view', 'members.invite.staff',
    'members.manage', 'audit.view', 'people.view', 'people.manage', 'people.merge', 'people.export',
    'consent.manage'
]) AS key
UNION ALL
SELECT '00000000-0000-7000-8000-000000000003'::uuid, key
FROM unnest(ARRAY['organization.view', 'members.view', 'people.view', 'people.manage']) AS key
UNION ALL
SELECT '00000000-0000-7000-8000-000000000004'::uuid, key
FROM unnest(ARRAY['organization.view']) AS key;

-- data from Phase 1 (docs/27 section 5, last paragraph) -------------------
-- Runs as the migrator, which owns the tables, so row-level security does not
-- hide any tenant here.

INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, created_at, updated_at)
SELECT m.organization_id,
       uuidv7(),
       m.id,
       CASE m.role
           WHEN 'owner' THEN '00000000-0000-7000-8000-000000000001'::uuid
           WHEN 'admin' THEN '00000000-0000-7000-8000-000000000002'::uuid
           WHEN 'staff' THEN '00000000-0000-7000-8000-000000000003'::uuid
           ELSE '00000000-0000-7000-8000-000000000004'::uuid
       END,
       'active',
       m.created_at,
       now()
FROM organizations.memberships m
WHERE m.status <> 'removed';

INSERT INTO people.people (organization_id, id, display_name, status, user_account_id, membership_id, source, created_at, updated_at)
SELECT m.organization_id,
       uuidv7(),
       coalesce(nullif(btrim(u.display_name), ''), split_part(u.email, '@', 1)),
       'active',
       u.id,
       m.id,
       CASE
           WHEN m.role = 'owner' THEN 'organization_created'
           WHEN EXISTS (
               SELECT 1 FROM organizations.invitations i
               WHERE i.organization_id = m.organization_id AND i.accepted_membership_id = m.id
           ) THEN 'invitation'
           ELSE 'join_link'
       END,
       m.created_at,
       now()
FROM organizations.memberships m
JOIN identity.user_accounts u ON u.id = m.user_account_id
WHERE m.status <> 'removed';

INSERT INTO people.contact_points (organization_id, id, person_id, type, value, is_primary, verified, created_at, updated_at)
SELECT p.organization_id, uuidv7(), p.id, 'email', lower(u.email), true, u.email_verified, p.created_at, now()
FROM people.people p
JOIN identity.user_accounts u ON u.id = p.user_account_id;

-- grants (docs/27 section 5, "Grants and RLS") ----------------------------

GRANT USAGE ON SCHEMA authz, people TO $app_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.roles, authz.role_permissions, authz.role_assignments TO $app_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations.ownership_transfers TO $app_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON people.people, people.contact_points, people.person_relationships,
    people.duplicate_candidates TO $app_role$;
GRANT SELECT, INSERT ON people.consents TO $app_role$;   -- append-only, like audit

GRANT USAGE ON SCHEMA authz, people TO $platform_role$;
GRANT SELECT ON ALL TABLES IN SCHEMA authz, people TO $platform_role$;
GRANT SELECT ON organizations.ownership_transfers TO $platform_role$;
-- A forced owner transfer (docs/27 section 3.5) swaps the two assignments and
-- keeps memberships.role in step for the release that still reads it.
GRANT INSERT, UPDATE ON authz.role_assignments TO $platform_role$;
GRANT UPDATE (role, updated_at, version) ON organizations.memberships TO $platform_role$;

-- row-level security -------------------------------------------------------

ALTER TABLE authz.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations.ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.person_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.duplicate_candidates ENABLE ROW LEVEL SECURITY;

-- System roles are readable by everyone and writable by nobody at runtime: the
-- write check needs the current tenant, which a NULL organization never is.
-- Account routes (GET /me) also see the custom roles of the caller's studios.
CREATE POLICY roles_app_select ON authz.roles FOR SELECT TO $app_role$
USING (
    organization_id IS NULL
    OR organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR EXISTS (
        SELECT 1 FROM organizations.memberships m
        WHERE m.organization_id = roles.organization_id
          AND m.user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
          AND m.status <> 'removed'
    )
);
CREATE POLICY roles_app_insert ON authz.roles FOR INSERT TO $app_role$
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY roles_app_update ON authz.roles FOR UPDATE TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY roles_app_delete ON authz.roles FOR DELETE TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- A role's permissions follow the role's visibility; only the tenant's own
-- custom roles can change.
CREATE POLICY role_permissions_app_select ON authz.role_permissions FOR SELECT TO $app_role$
USING (EXISTS (SELECT 1 FROM authz.roles r WHERE r.id = role_permissions.role_id));
CREATE POLICY role_permissions_app_insert ON authz.role_permissions FOR INSERT TO $app_role$
WITH CHECK (EXISTS (
    SELECT 1 FROM authz.roles r
    WHERE r.id = role_permissions.role_id
      AND r.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
));
CREATE POLICY role_permissions_app_delete ON authz.role_permissions FOR DELETE TO $app_role$
USING (EXISTS (
    SELECT 1 FROM authz.roles r
    WHERE r.id = role_permissions.role_id
      AND r.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
));

-- Tenant routes see their tenant; account routes see the caller's own
-- assignments (GET /me lists roles and permissions per studio).
CREATE POLICY role_assignments_app ON authz.role_assignments TO $app_role$
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR EXISTS (
        SELECT 1 FROM organizations.memberships m
        WHERE m.organization_id = role_assignments.organization_id
          AND m.id = role_assignments.membership_id
          AND m.user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
    )
)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- GET /me shows a pending transfer to both sides.
CREATE POLICY ownership_transfers_app ON organizations.ownership_transfers TO $app_role$
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR EXISTS (
        SELECT 1 FROM organizations.memberships m
        WHERE m.organization_id = ownership_transfers.organization_id
          AND m.id IN (ownership_transfers.from_membership_id, ownership_transfers.to_membership_id)
          AND m.user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
    )
)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- The self clause: a member reads their own person record in every studio.
CREATE POLICY people_app_select ON people.people FOR SELECT TO $app_role$
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
);
CREATE POLICY people_app_write ON people.people FOR ALL TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY contact_points_app ON people.contact_points TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY consents_app ON people.consents TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY person_relationships_app ON people.person_relationships TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY duplicate_candidates_app ON people.duplicate_candidates TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- Operators see every tenant; their grants above limit what they may change.
CREATE POLICY roles_platform ON authz.roles TO $platform_role$ USING (true);
CREATE POLICY role_permissions_platform ON authz.role_permissions TO $platform_role$ USING (true);
CREATE POLICY role_assignments_platform ON authz.role_assignments TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY ownership_transfers_platform ON organizations.ownership_transfers TO $platform_role$ USING (true);
CREATE POLICY people_platform ON people.people TO $platform_role$ USING (true);
CREATE POLICY contact_points_platform ON people.contact_points TO $platform_role$ USING (true);
CREATE POLICY consents_platform ON people.consents TO $platform_role$ USING (true);
CREATE POLICY person_relationships_platform ON people.person_relationships TO $platform_role$ USING (true);
CREATE POLICY duplicate_candidates_platform ON people.duplicate_candidates TO $platform_role$ USING (true);

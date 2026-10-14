-- Phase 1: identity, organizations, memberships, invitations, audit and
-- platform operators (docs/26_Identity_Organization_Membership_LLD.md
-- section 7).
--
-- Runs as the migrator role, which owns every object here. The runtime role
-- names come from DbUp variables ($app_role$, $platform_role$), so the same
-- script serves every environment and the integration tests' per-test roles.
--
-- Row-level security is enabled, not forced: the owner (the migrator) is
-- exempt, which is what lets the two SECURITY DEFINER lookups below find a
-- row before any tenant is known. Neither runtime role owns anything, so RLS
-- always applies to them.

CREATE SCHEMA identity;
CREATE SCHEMA organizations;
CREATE SCHEMA audit;
CREATE SCHEMA platform_admin;

-- identity ---------------------------------------------------------------

CREATE TABLE identity.user_accounts (
    id                 uuid PRIMARY KEY,
    status             text NOT NULL CHECK (status IN ('active', 'disabled')),
    email              text NOT NULL,
    email_verified     boolean NOT NULL,
    display_name       text,
    locale             text NOT NULL DEFAULT 'he-IL',
    identity_synced_at timestamptz NOT NULL,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    version            bigint NOT NULL DEFAULT 0
);
CREATE INDEX ix_user_accounts_email ON identity.user_accounts (lower(email));

CREATE TABLE identity.external_identities (
    id              uuid PRIMARY KEY,
    user_account_id uuid NOT NULL REFERENCES identity.user_accounts (id),
    issuer          text NOT NULL,
    subject         text NOT NULL,
    created_at      timestamptz NOT NULL,
    UNIQUE (issuer, subject)
);
CREATE INDEX ix_external_identities_user ON identity.external_identities (user_account_id);

-- organizations ----------------------------------------------------------

CREATE TABLE organizations.organizations (
    id                 uuid PRIMARY KEY,
    slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
    display_name       text NOT NULL,
    status             text NOT NULL CHECK (status IN ('active', 'suspended')),
    country_code       char(2) NOT NULL DEFAULT 'IL',
    default_locale     text NOT NULL DEFAULT 'he-IL',
    time_zone          text NOT NULL DEFAULT 'Asia/Jerusalem',
    currency_code      char(3) NOT NULL DEFAULT 'ILS',
    join_code_hash     bytea UNIQUE,
    created_by_user_id uuid NOT NULL REFERENCES identity.user_accounts (id),
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    version            bigint NOT NULL DEFAULT 0
);
CREATE INDEX ix_organizations_created_by ON organizations.organizations (created_by_user_id);

CREATE TABLE organizations.memberships (
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    id              uuid NOT NULL,
    user_account_id uuid NOT NULL REFERENCES identity.user_accounts (id),
    role            text NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'client')),
    status          text NOT NULL CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX ux_memberships_one_live ON organizations.memberships (organization_id, user_account_id)
    WHERE status <> 'removed';
CREATE UNIQUE INDEX ux_memberships_one_owner ON organizations.memberships (organization_id)
    WHERE role = 'owner' AND status <> 'removed';
CREATE INDEX ix_memberships_user ON organizations.memberships (user_account_id) WHERE status <> 'removed';

CREATE TABLE organizations.invitations (
    organization_id          uuid NOT NULL REFERENCES organizations.organizations (id),
    id                       uuid NOT NULL,
    email                    text NOT NULL,
    role                     text NOT NULL CHECK (role IN ('admin', 'staff', 'client')),
    token_hash               bytea NOT NULL UNIQUE,
    status                   text NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
    expires_at               timestamptz NOT NULL,
    invited_by_membership_id uuid NOT NULL,
    accepted_membership_id   uuid,
    created_at               timestamptz NOT NULL,
    updated_at               timestamptz NOT NULL,
    version                  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, invited_by_membership_id) REFERENCES organizations.memberships (organization_id, id),
    FOREIGN KEY (organization_id, accepted_membership_id) REFERENCES organizations.memberships (organization_id, id)
);
CREATE UNIQUE INDEX ux_invitations_one_pending ON organizations.invitations (organization_id, lower(email))
    WHERE status = 'pending';

-- audit ------------------------------------------------------------------

CREATE TABLE audit.audit_events (
    id              uuid PRIMARY KEY,
    organization_id uuid REFERENCES organizations.organizations (id),
    occurred_at     timestamptz NOT NULL,
    actor_type      text NOT NULL CHECK (actor_type IN ('user', 'operator', 'system')),
    actor_id        uuid,
    action          text NOT NULL,
    target_type     text NOT NULL,
    target_id       uuid,
    correlation_id  text NOT NULL,
    data            jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_audit_events_org_time ON audit.audit_events (organization_id, occurred_at DESC);

-- platform operators -----------------------------------------------------

CREATE TABLE platform_admin.operators (
    id          uuid PRIMARY KEY,
    email       text NOT NULL UNIQUE,
    issuer      text,
    subject     text,
    status      text NOT NULL CHECK (status IN ('active', 'disabled')),
    created_at  timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL,
    version     bigint NOT NULL DEFAULT 0,
    UNIQUE (issuer, subject)
);

-- grants (LLD section 7.2) -----------------------------------------------
-- The audit table is append-only for both runtime roles: no UPDATE or DELETE.

GRANT USAGE ON SCHEMA identity, organizations, audit TO $app_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO $app_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA organizations TO $app_role$;
GRANT SELECT, INSERT ON audit.audit_events TO $app_role$;

GRANT USAGE ON SCHEMA identity, organizations, audit, platform_admin TO $platform_role$;
GRANT SELECT ON ALL TABLES IN SCHEMA identity, organizations, audit TO $platform_role$;
GRANT UPDATE (status, updated_at, version) ON organizations.organizations TO $platform_role$;
GRANT INSERT ON audit.audit_events TO $platform_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admin.operators TO $platform_role$;

-- row-level security (LLD section 7.3) -----------------------------------
-- The API sets app.user_account_id and app.organization_id with
-- set_config(..., true) at the start of each transaction. A missing value
-- reads as NULL, so a query outside such a transaction sees no rows.

ALTER TABLE organizations.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;

-- A studio is visible as the current tenant or to its live members. Creating
-- one runs before any tenant exists, so insert checks the creator instead;
-- the API sets the new id as the tenant first, so RETURNING can see the row.
CREATE POLICY organizations_app_select ON organizations.organizations FOR SELECT TO $app_role$
USING (
    id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR EXISTS (
        SELECT 1
        FROM organizations.memberships m
        WHERE m.organization_id = organizations.id
          AND m.user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
          AND m.status <> 'removed'
    )
);
CREATE POLICY organizations_app_insert ON organizations.organizations FOR INSERT TO $app_role$
WITH CHECK (created_by_user_id = nullif(current_setting('app.user_account_id', true), '')::uuid);
CREATE POLICY organizations_app_update ON organizations.organizations FOR UPDATE TO $app_role$
USING (id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- Tenant routes see their tenant; account routes (GET /me) see the caller's
-- own memberships. Writes stay inside the tenant.
CREATE POLICY memberships_app ON organizations.memberships TO $app_role$
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

CREATE POLICY invitations_app ON organizations.invitations TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- Account-level events (a new account, a new studio) have no tenant yet.
CREATE POLICY audit_events_app_select ON audit.audit_events FOR SELECT TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY audit_events_app_insert ON audit.audit_events FOR INSERT TO $app_role$
WITH CHECK (
    organization_id IS NULL
    OR organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
);

-- Operators see every tenant; their grants above limit what they may change.
CREATE POLICY organizations_platform ON organizations.organizations TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY memberships_platform ON organizations.memberships TO $platform_role$ USING (true);
CREATE POLICY invitations_platform ON organizations.invitations TO $platform_role$ USING (true);
CREATE POLICY audit_events_platform ON audit.audit_events TO $platform_role$ USING (true) WITH CHECK (true);

-- lookups before a tenant is known ---------------------------------------
-- Owned by the migrator, so they read past RLS, and return only the row that
-- matches the hash. The fixed search_path keeps a caller's objects out.

CREATE FUNCTION organizations.find_invitation_by_token_hash(token_hash bytea)
RETURNS SETOF organizations.invitations
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT i.* FROM organizations.invitations i WHERE i.token_hash = find_invitation_by_token_hash.token_hash
$$;

CREATE FUNCTION organizations.find_organization_by_join_code_hash(join_code_hash bytea)
RETURNS TABLE (id uuid, slug text, display_name text, status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT o.id, o.slug, o.display_name, o.status
    FROM organizations.organizations o
    WHERE o.join_code_hash = find_organization_by_join_code_hash.join_code_hash
$$;

REVOKE ALL ON FUNCTION organizations.find_invitation_by_token_hash(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION organizations.find_organization_by_join_code_hash(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organizations.find_invitation_by_token_hash(bytea) TO $app_role$;
GRANT EXECUTE ON FUNCTION organizations.find_organization_by_join_code_hash(bytea) TO $app_role$;

CREATE TABLE IF NOT EXISTS organizations.memberships (
    organization_id uuid NOT NULL,
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    status text NOT NULL,
    display_name text NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT memberships_pkey PRIMARY KEY (organization_id, id),
    CONSTRAINT memberships_user_key UNIQUE (organization_id, user_id),
    CONSTRAINT memberships_organization_fkey FOREIGN KEY (organization_id)
        REFERENCES organizations.organizations (id)
);

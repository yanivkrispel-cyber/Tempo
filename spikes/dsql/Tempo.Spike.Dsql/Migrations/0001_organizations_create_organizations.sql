-- Tenant root. Every other tenant-owned table carries organization_id as the
-- first column of its primary key and of every foreign key (structural
-- tenant isolation, council decision Q6).
CREATE TABLE IF NOT EXISTS organizations.organizations (
    id uuid NOT NULL,
    slug text NOT NULL,
    display_name text NOT NULL,
    status text NOT NULL,
    time_zone text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT organizations_pkey PRIMARY KEY (id),
    CONSTRAINT organizations_slug_key UNIQUE (slug)
);

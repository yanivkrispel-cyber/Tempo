CREATE TABLE IF NOT EXISTS scheduling.rooms (
    organization_id uuid NOT NULL,
    id uuid NOT NULL,
    name text NOT NULL,
    CONSTRAINT rooms_pkey PRIMARY KEY (organization_id, id),
    CONSTRAINT rooms_organization_fkey FOREIGN KEY (organization_id)
        REFERENCES organizations.organizations (id)
);

-- Studio marketing, stage A (docs/37_Studio_Marketing_LLD.md sections 4 to 6, D23, board #380 MK1): the studio's
-- public page settings, the links Tempo hands out with their source codes, first-touch and last-touch sources, the
-- intro pass "to pay at the studio", and the instructor's consent to a public profile. 0033 is reserved for #374.

-- The public page (M-7, M-8, M-9, M-13): one row per studio, written on the first save; off until the owner says so.
-- The intro product is one of this studio's own products (the composite key keeps another studio's out).
CREATE TABLE organizations.public_pages (
    organization_id   uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    enabled           boolean NOT NULL DEFAULT false,
    open_join         boolean NOT NULL DEFAULT true,
    intro_product_id  uuid,
    suggest_weekly_at text CHECK (suggest_weekly_at ~ '^(sun|mon|tue|wed|thu|fri|sat) ([01][0-9]|2[0-3]):[0-5][0-9]$'),
    version           bigint NOT NULL DEFAULT 0,
    updated_at        timestamptz NOT NULL,
    updated_by        uuid NOT NULL,
    FOREIGN KEY (organization_id, intro_product_id) REFERENCES scheduling.pass_products (organization_id, id)
);

-- Links (section 6): each share gets a short code that is neither personal nor secret.
CREATE SCHEMA marketing;
CREATE TABLE marketing.links (
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    id              uuid NOT NULL,
    code            text NOT NULL CHECK (code ~ '^[a-z0-9]{6,10}$'),
    channel         text NOT NULL CHECK (channel IN ('story', 'whatsapp', 'bio', 'poster', 'member_card', 'referral', 'other')),
    template        text CHECK (template ~ '^[a-z_]{1,32}$'),
    session_id      uuid,
    created_by      uuid NOT NULL,
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, code),
    FOREIGN KEY (organization_id, session_id) REFERENCES scheduling.sessions (organization_id, id)
);

-- First touch on the membership, last touch on the booking (M-12): set once, never edited.
ALTER TABLE organizations.memberships ADD COLUMN source_link_id uuid;
ALTER TABLE organizations.memberships ADD CONSTRAINT memberships_source_link
    FOREIGN KEY (organization_id, source_link_id) REFERENCES marketing.links (organization_id, id);
ALTER TABLE scheduling.bookings ADD COLUMN source_link_id uuid;
ALTER TABLE scheduling.bookings ADD CONSTRAINT bookings_source_link
    FOREIGN KEY (organization_id, source_link_id) REFERENCES marketing.links (organization_id, id);

-- The intro pass granted through the public page is paid at the studio (M-8); staff see it on the roster.
ALTER TABLE scheduling.passes ADD COLUMN to_pay_at_studio boolean NOT NULL DEFAULT false;

-- The instructor's own consent to show their name, photo, headline and handle to strangers (M-14). `visible`
-- (shown to members) stays separate.
ALTER TABLE organizations.staff_profiles ADD COLUMN public_profile boolean NOT NULL DEFAULT false;

-- Permissions (section 5): every class for owners and admins, one's own classes for staff.
INSERT INTO authz.role_permissions (role_id, permission_key) VALUES
    ('00000000-0000-7000-8000-000000000001'::uuid, 'marketing.publish'),
    ('00000000-0000-7000-8000-000000000002'::uuid, 'marketing.publish'),
    ('00000000-0000-7000-8000-000000000001'::uuid, 'marketing.publish.own'),
    ('00000000-0000-7000-8000-000000000002'::uuid, 'marketing.publish.own'),
    ('00000000-0000-7000-8000-000000000003'::uuid, 'marketing.publish.own');

ALTER TABLE organizations.public_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_pages_app ON organizations.public_pages TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON organizations.public_pages TO $app_role$;

ALTER TABLE marketing.links ENABLE ROW LEVEL SECURITY;
CREATE POLICY links_app ON marketing.links TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
GRANT USAGE ON SCHEMA marketing TO $app_role$;
GRANT SELECT, INSERT ON marketing.links TO $app_role$;

-- The public routes resolve a slug before any tenant is known (WL4's route group), as the platform role.
GRANT SELECT ON organizations.public_pages TO $platform_role$;
CREATE POLICY public_pages_platform ON organizations.public_pages TO $platform_role$ USING (true);
GRANT USAGE ON SCHEMA marketing TO $platform_role$;

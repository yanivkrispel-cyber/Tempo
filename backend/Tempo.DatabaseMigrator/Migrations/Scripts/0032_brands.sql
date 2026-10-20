-- The studio's brand (docs/35_White_Label_LLD.md section 2, WL1, board #380 K1): the name under the home-screen icon,
-- one of the eight approved accents, the logo, the icon and the icon's background. One row per studio, written on
-- the first change (inserted at version 0 and bumped by that change); until then the API answers the defaults (the
-- display name, sage, paper) at version 0. `version` goes up on every change, including a new logo or icon, because
-- the public icon and manifest URLs carry it (W-6).
CREATE TABLE organizations.brands (
    organization_id uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    app_name        text NOT NULL CHECK (char_length(app_name) BETWEEN 1 AND 12 AND app_name = btrim(app_name)),
    accent_id       text NOT NULL DEFAULT 'sage'
                    CHECK (accent_id IN ('sage', 'olive', 'ocean', 'plum', 'rose', 'terracotta', 'sand', 'graphite')),
    logo_media_id   uuid,
    icon_media_id   uuid,
    icon_background text NOT NULL DEFAULT 'paper' CHECK (icon_background IN ('paper', 'accent')),
    version         bigint NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL
);

-- The logo and the icon are pictures like the others (docs/33 section 6); the icon's finalize also renders the PNG
-- sizes a phone installs.
ALTER TABLE media.media_objects DROP CONSTRAINT media_objects_purpose_check;
ALTER TABLE media.media_objects ADD CONSTRAINT media_objects_purpose_check
    CHECK (purpose IN ('class_cover', 'instructor_photo', 'studio_cover', 'avatar', 'studio_logo', 'studio_icon'));

ALTER TABLE organizations.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY brands_app ON organizations.brands TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON organizations.brands TO $app_role$;

-- The public manifest and icons (WL4) are read before any tenant is known, as the platform role.
GRANT SELECT ON organizations.brands TO $platform_role$;
CREATE POLICY brands_platform ON organizations.brands TO $platform_role$ USING (true);

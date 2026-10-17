-- Pictures, instructor profiles and the instructor's note (docs/33_Studio_Experience_LLD.md sections 5 to 7, D17,
-- step E4).
--
-- Pictures: the bytes are in the environment's private S3 bucket; this table holds what the API needs to point at
-- them. A row is `pending` while the app uploads, `ready` once the API re-encoded it to WebP (two sizes, no
-- metadata), `rejected` when it was not a usable image, `deleted` once replaced or removed. The object keys follow
-- media/<id>/(large|small).webp, so a URL never needs this table.
CREATE SCHEMA media;

CREATE TABLE media.media_objects (
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    id              uuid NOT NULL,
    purpose         text NOT NULL CHECK (purpose IN ('class_cover', 'instructor_photo', 'studio_cover', 'avatar')),
    owner_id        uuid NOT NULL,
    status          text NOT NULL CHECK (status IN ('pending', 'ready', 'rejected', 'deleted')),
    content_type    text NOT NULL,
    declared_bytes  int NOT NULL CHECK (declared_bytes BETWEEN 1 AND 8388608),
    width           int,
    height          int,
    bytes           int,
    created_by      uuid NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id)
);
CREATE INDEX ix_media_objects_owner ON media.media_objects (organization_id, purpose, owner_id) WHERE status = 'ready';

ALTER TABLE scheduling.class_types ADD COLUMN cover_media_id uuid;
ALTER TABLE organizations.organizations ADD COLUMN cover_media_id uuid;
ALTER TABLE people.people ADD COLUMN avatar_media_id uuid;

-- Instructor profiles (section 5): public inside the studio. One row per staff membership, created on first save.
CREATE TABLE organizations.staff_profiles (
    organization_id  uuid NOT NULL,
    membership_id    uuid NOT NULL,
    headline         text CHECK (length(headline) <= 80),
    bio              text CHECK (length(bio) <= 600),
    instagram_handle text CHECK (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
    playlist_url     text CHECK (length(playlist_url) <= 300),
    photo_media_id   uuid,
    visible          boolean NOT NULL DEFAULT true,
    updated_at       timestamptz NOT NULL,
    version          bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, membership_id),
    FOREIGN KEY (organization_id, membership_id) REFERENCES organizations.memberships (organization_id, id)
);

-- The instructor's note to the class (section 7), shown to booked and waiting members. A weekly class's note is
-- copied to the sessions it materializes, like its instructor.
ALTER TABLE scheduling.sessions ADD COLUMN member_note text CHECK (length(member_note) <= 200);
ALTER TABLE scheduling.templates ADD COLUMN member_note text CHECK (length(member_note) <= 200);

ALTER TABLE media.media_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_objects_app ON media.media_objects TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

ALTER TABLE organizations.staff_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_profiles_app ON organizations.staff_profiles TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

GRANT USAGE ON SCHEMA media TO $app_role$;
GRANT SELECT, INSERT, UPDATE ON media.media_objects TO $app_role$;
-- Removing a studio (docs/32 section 10) reads its pictures' ids first, to delete their objects after the rows.
GRANT USAGE ON SCHEMA media TO $platform_role$;
GRANT SELECT ON media.media_objects TO $platform_role$;
CREATE POLICY media_objects_platform ON media.media_objects TO $platform_role$ USING (true);
GRANT SELECT, INSERT, UPDATE ON organizations.staff_profiles TO $app_role$;
-- The daily job materializes sessions as the platform role; it copies the template's note.
GRANT SELECT (member_note) ON scheduling.templates TO $platform_role$;

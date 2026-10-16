-- Phase 4 step 7, studio announcements (docs/30_Communications_LLD.md section 13 step 7; day board #208, T3).
-- One row per announcement; its text lives here once and each member's `studio.announcement` inbox item points
-- at it by id, as with notifications.session_messages. The audit log keeps the count, never the text.
CREATE TABLE notifications.announcements (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    sent_by          uuid NOT NULL,                       -- the staff membership
    subject          text NOT NULL CHECK (length(subject) BETWEEN 1 AND 80),
    body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    recipients       int NOT NULL CHECK (recipients BETWEEN 0 AND 500),
    created_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id) REFERENCES organizations.organizations (id),
    FOREIGN KEY (organization_id, sent_by) REFERENCES organizations.memberships (organization_id, id)
);
CREATE INDEX ix_announcements_created ON notifications.announcements (organization_id, created_at DESC);

ALTER TABLE notifications.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY announcements_app ON notifications.announcements TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY announcements_platform ON notifications.announcements TO $platform_role$ USING (true);

GRANT SELECT, INSERT ON notifications.announcements TO $app_role$;
GRANT SELECT, DELETE ON notifications.announcements TO $platform_role$;   -- the retention job (B4), with the inbox items

-- Each member's request points at the announcement.
ALTER TABLE notifications.requests DROP CONSTRAINT requests_subject_type_check;
ALTER TABLE notifications.requests ADD CONSTRAINT requests_subject_type_check
    CHECK (subject_type IN ('booking', 'session', 'pass', 'session_message', 'announcement'));

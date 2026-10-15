-- Night of 2026-10-15 (board #136): a booking moved to another class (docs/29 section 16.1), a short
-- message from staff to everyone registered on a class (section 16.2), and the grants the retention
-- job needs (lane K-B, B4).

-- A moved booking keeps its entry and leaves a cancelled row behind in the old class with the reason
-- `moved`, so history shows where the place went.
ALTER TABLE scheduling.bookings DROP CONSTRAINT bookings_cancel_reason_check;
ALTER TABLE scheduling.bookings
    ADD CONSTRAINT bookings_cancel_reason_check
    CHECK (cancel_reason IN ('self', 'staff', 'session_cancelled', 'no_valid_pass', 'moved'));

-- One row per message sent to a class. The text lives here, once; each recipient's inbox item points
-- at it by id (data holds ids only, as always). The audit log never holds the text.
CREATE TABLE notifications.session_messages (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    session_id       uuid NOT NULL,
    sent_by          uuid NOT NULL,                       -- the staff membership
    body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
    recipients       int NOT NULL CHECK (recipients >= 0),
    created_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, session_id) REFERENCES scheduling.sessions (organization_id, id),
    FOREIGN KEY (organization_id, sent_by) REFERENCES organizations.memberships (organization_id, id)
);
CREATE INDEX ix_session_messages_session ON notifications.session_messages (organization_id, session_id, created_at DESC);

ALTER TABLE notifications.session_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_messages_app ON notifications.session_messages TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY session_messages_platform ON notifications.session_messages TO $platform_role$ USING (true);

GRANT SELECT, INSERT ON notifications.session_messages TO $app_role$;
GRANT SELECT ON notifications.session_messages TO $platform_role$;

-- Erasing a person removes their inbox items that carry a message (section 16.2); the app role could
-- only insert and update them until now.
GRANT DELETE ON notifications.inbox_items TO $app_role$;

-- Retention job (lane K-B, B4): the platform role removes what the policy says is past keeping. The
-- platform policies on both tables are USING (true) already; only the grants were missing.
GRANT DELETE ON organizations.invitations TO $platform_role$;
GRANT DELETE ON notifications.inbox_items TO $platform_role$;

-- Phase 4 part one, notifications (docs/30_Communications_LLD.md, sections 5 to 8; day board #176, P2):
-- templates, the studio's notification settings, a person's preferences, quiet hours and reminder switches,
-- web-push subscriptions, and the delivery queue (requests and deliveries). 0011 to 0013 went to docs/29
-- section 16 and #124. Rows keep ids, never a rendered text or an address (docs/30 section 2).

-- Templates: the words for one kind, per studio (NULL is the platform default), locale, channel and version.
-- Part one renders the platform defaults from code; studio templates are step 7.
CREATE TABLE notifications.templates (
    id               uuid PRIMARY KEY,
    organization_id  uuid REFERENCES organizations.organizations (id),
    kind             text NOT NULL CHECK (kind ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
    locale           text NOT NULL CHECK (locale IN ('he', 'en')),
    channel          text NOT NULL CHECK (channel IN ('inbox', 'email', 'push', 'sms', 'whatsapp')),
    version          int NOT NULL CHECK (version >= 1),
    subject          text CHECK (length(subject) <= 200),
    body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    status           text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
    created_by       uuid,                                 -- the staff membership; NULL for platform defaults
    created_at       timestamptz NOT NULL
);
CREATE UNIQUE INDEX ux_templates_version
    ON notifications.templates (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, locale, channel, version);
CREATE UNIQUE INDEX ux_templates_active
    ON notifications.templates (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, locale, channel)
    WHERE status = 'active';

-- The studio's quiet hours and reminder timing. No row means the defaults below (D-4, D-5).
CREATE TABLE notifications.studio_settings (
    organization_id             uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    quiet_starts_local          time NOT NULL DEFAULT '22:00',
    quiet_ends_local            time NOT NULL DEFAULT '08:00',
    class_tomorrow_enabled      boolean NOT NULL DEFAULT true,
    class_tomorrow_send_at      time NOT NULL DEFAULT '18:00',
    class_soon_enabled          boolean NOT NULL DEFAULT true,
    class_soon_hours_before     int NOT NULL DEFAULT 2 CHECK (class_soon_hours_before BETWEEN 1 AND 12),
    pass_ending_enabled         boolean NOT NULL DEFAULT true,
    pass_ending_days_before     int NOT NULL DEFAULT 7 CHECK (pass_ending_days_before BETWEEN 1 AND 30),
    entries_low_enabled         boolean NOT NULL DEFAULT true,
    entries_low_left            int NOT NULL DEFAULT 1 CHECK (entries_low_left BETWEEN 1 AND 5),
    updated_at                  timestamptz NOT NULL,
    version                     int NOT NULL DEFAULT 1,
    CHECK (quiet_starts_local <> quiet_ends_local)
);

-- A person's channels per group in one studio. No row means the group's default channels (docs/30 section 5).
CREATE TABLE notifications.preferences (
    organization_id  uuid NOT NULL,
    person_id        uuid NOT NULL,
    "group"          text NOT NULL CHECK ("group" IN ('bookings', 'reminders', 'studio')),
    channel          text NOT NULL CHECK (channel IN ('inbox', 'email', 'push', 'sms', 'whatsapp')),
    enabled          boolean NOT NULL,
    updated_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id, "group", channel),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    CHECK (channel <> 'inbox' OR enabled)                  -- the inbox cannot be switched off
);

-- A person's own quiet hours in one studio, in the studio's time zone. No row means the studio's window.
CREATE TABLE notifications.quiet_hours (
    organization_id  uuid NOT NULL,
    person_id        uuid NOT NULL,
    starts_local     time NOT NULL,
    ends_local       time NOT NULL,
    updated_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    CHECK (starts_local <> ends_local)
);

-- A person's switch per reminder kind. No row means on, when the studio offers it.
CREATE TABLE notifications.reminder_switches (
    organization_id  uuid NOT NULL,
    person_id        uuid NOT NULL,
    reminder         text NOT NULL CHECK (reminder IN ('class_tomorrow', 'class_soon', 'pass_ending', 'entries_low')),
    enabled          boolean NOT NULL,
    updated_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id, reminder),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);

-- The settings page reads one version for preferences, quiet hours and switches together.
CREATE TABLE notifications.preference_versions (
    organization_id  uuid NOT NULL,
    person_id        uuid NOT NULL,
    version          int NOT NULL DEFAULT 1,
    updated_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);

-- A browser's push subscription for a person in one studio (docs/30 section 4.3). The endpoint and keys never
-- leave the server; a 404 or 410 from the push service deletes the row.
CREATE TABLE notifications.push_subscriptions (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    person_id        uuid NOT NULL,
    endpoint         text NOT NULL CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 2048),
    p256dh           text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 128),
    auth             text NOT NULL CHECK (length(auth) BETWEEN 1 AND 64),
    device_label     text NOT NULL CHECK (length(device_label) BETWEEN 1 AND 60),
    created_at       timestamptz NOT NULL,
    last_success_at  timestamptz,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE UNIQUE INDEX ux_push_subscriptions_endpoint ON notifications.push_subscriptions (organization_id, person_id, endpoint);

-- "Tell this person about this subject" (docs/30 section 8). The dedupe key makes a retried job or handler
-- harmless: {kind}:{subject_id}:{person_id}:{occurrence}.
CREATE TABLE notifications.requests (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    kind             text NOT NULL CHECK (kind ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
    person_id        uuid NOT NULL,
    subject_type     text NOT NULL CHECK (subject_type IN ('booking', 'session', 'pass', 'session_message')),
    subject_id       uuid NOT NULL,
    data             jsonb NOT NULL DEFAULT '{}',          -- ids only, never names
    dedupe_key       text NOT NULL CHECK (length(dedupe_key) <= 300),
    created_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE UNIQUE INDEX ux_requests_dedupe ON notifications.requests (organization_id, dedupe_key);
CREATE INDEX ix_requests_person ON notifications.requests (organization_id, person_id, created_at DESC);
CREATE INDEX ix_requests_created ON notifications.requests (created_at);

-- One line per channel for a request. Never the text, never the address; the error is a code.
CREATE TABLE notifications.deliveries (
    organization_id      uuid NOT NULL,
    id                   uuid NOT NULL,
    request_id           uuid NOT NULL,
    channel              text NOT NULL CHECK (channel IN ('inbox', 'email', 'push', 'sms', 'whatsapp')),
    status               text NOT NULL CHECK (status IN ('queued', 'sending', 'accepted', 'delivered', 'failed',
                                                         'retry_scheduled', 'dead', 'skipped')),
    skip_reason          text CHECK (skip_reason IN ('preference_off', 'quiet_hours', 'no_subscription',
                                                     'undeliverable', 'no_consent', 'channel_unavailable')),
    attempts             int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at      timestamptz,
    provider_message_id  text CHECK (length(provider_message_id) <= 200),
    last_error_code      text CHECK (length(last_error_code) <= 60),
    created_at           timestamptz NOT NULL,
    updated_at           timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, request_id) REFERENCES notifications.requests (organization_id, id) ON DELETE CASCADE,
    CHECK ((status = 'skipped') = (skip_reason IS NOT NULL))
);
CREATE UNIQUE INDEX ux_deliveries_request_channel ON notifications.deliveries (organization_id, request_id, channel);
CREATE INDEX ix_deliveries_due ON notifications.deliveries (next_attempt_at) WHERE status IN ('queued', 'retry_scheduled');
CREATE INDEX ix_deliveries_created ON notifications.deliveries (created_at);

-- The inbox item shows its delivery status in the console (docs/30 section 4.1). A request can go before its
-- inbox item (90 against 180 days), so the link clears instead of blocking the retention job.
ALTER TABLE notifications.inbox_items ADD COLUMN request_id uuid;
ALTER TABLE notifications.inbox_items
    ADD CONSTRAINT inbox_items_request_fk FOREIGN KEY (organization_id, request_id)
    REFERENCES notifications.requests (organization_id, id) ON DELETE SET NULL (request_id);

-- grants -------------------------------------------------------------------

-- The API: settings pages, subscriptions, and requests written with the inbox item in the same transaction.
-- DELETE on a person's rows is for erase (docs/30 section 7).
GRANT SELECT ON notifications.templates TO $app_role$;
GRANT SELECT, INSERT, UPDATE ON notifications.studio_settings TO $app_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.preferences, notifications.quiet_hours,
    notifications.reminder_switches, notifications.preference_versions, notifications.push_subscriptions TO $app_role$;
GRANT SELECT, INSERT, DELETE ON notifications.requests TO $app_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.deliveries TO $app_role$;

-- The worker (notifications.deliver, the reminder jobs, the retention job) runs as the platform role.
GRANT SELECT ON ALL TABLES IN SCHEMA notifications TO $platform_role$;
GRANT INSERT ON notifications.requests, notifications.deliveries TO $platform_role$;
GRANT UPDATE (status, skip_reason, attempts, next_attempt_at, provider_message_id, last_error_code, updated_at)
    ON notifications.deliveries TO $platform_role$;
GRANT UPDATE (request_id) ON notifications.inbox_items TO $platform_role$;
GRANT UPDATE (last_success_at) ON notifications.push_subscriptions TO $platform_role$;
GRANT DELETE ON notifications.push_subscriptions, notifications.requests, notifications.deliveries TO $platform_role$;

-- row-level security -------------------------------------------------------

ALTER TABLE notifications.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.studio_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.quiet_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.reminder_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.preference_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.deliveries ENABLE ROW LEVEL SECURITY;

-- A studio reads its own templates and the platform defaults; it has no write grant in part one.
CREATE POLICY templates_app ON notifications.templates FOR SELECT TO $app_role$
USING (organization_id IS NULL OR organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY studio_settings_app ON notifications.studio_settings TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY preferences_app ON notifications.preferences TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY quiet_hours_app ON notifications.quiet_hours TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY reminder_switches_app ON notifications.reminder_switches TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY preference_versions_app ON notifications.preference_versions TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY push_subscriptions_app ON notifications.push_subscriptions TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY requests_app ON notifications.requests TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY deliveries_app ON notifications.deliveries TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- The worker sees every tenant; its grants above limit what it may change.
CREATE POLICY templates_platform ON notifications.templates TO $platform_role$ USING (true);
CREATE POLICY studio_settings_platform ON notifications.studio_settings TO $platform_role$ USING (true);
CREATE POLICY preferences_platform ON notifications.preferences TO $platform_role$ USING (true);
CREATE POLICY quiet_hours_platform ON notifications.quiet_hours TO $platform_role$ USING (true);
CREATE POLICY reminder_switches_platform ON notifications.reminder_switches TO $platform_role$ USING (true);
CREATE POLICY preference_versions_platform ON notifications.preference_versions TO $platform_role$ USING (true);
CREATE POLICY push_subscriptions_platform ON notifications.push_subscriptions TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY requests_platform ON notifications.requests TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY deliveries_platform ON notifications.deliveries TO $platform_role$ USING (true) WITH CHECK (true);

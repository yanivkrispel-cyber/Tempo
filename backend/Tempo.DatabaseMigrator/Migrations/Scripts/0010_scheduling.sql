-- Studio scheduling and passes (docs/29_Studio_Scheduling_and_Passes_LLD.md, sections 7 and 8):
-- rooms, class types, weekly templates, sessions, bookings, pass products, passes and their
-- ledger, the booking policy, and a minimal in-app inbox. 0009 is billing (docs/28).

CREATE SCHEMA scheduling;
CREATE SCHEMA notifications;

CREATE TABLE scheduling.booking_policies (
    organization_id        uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    free_cancel_hours      int NOT NULL DEFAULT 6 CHECK (free_cancel_hours BETWEEN 0 AND 72),
    waitlist_cutoff_hours  int NOT NULL DEFAULT 2 CHECK (waitlist_cutoff_hours BETWEEN 0 AND 24),
    booking_horizon_days   int NOT NULL DEFAULT 14 CHECK (booking_horizon_days BETWEEN 1 AND 56),
    waitlist_enabled       boolean NOT NULL DEFAULT true,
    updated_at             timestamptz NOT NULL,
    version                bigint NOT NULL DEFAULT 0
);

CREATE TABLE scheduling.rooms (
    organization_id  uuid NOT NULL REFERENCES organizations.organizations (id),
    id               uuid NOT NULL,
    name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    default_capacity int NOT NULL CHECK (default_capacity BETWEEN 1 AND 500),
    status           text NOT NULL CHECK (status IN ('active', 'archived')),
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    version          bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);

CREATE TABLE scheduling.class_types (
    organization_id  uuid NOT NULL REFERENCES organizations.organizations (id),
    id               uuid NOT NULL,
    name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    category         text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,29}$'),
    color            text NOT NULL CHECK (color IN ('sage', 'rose', 'taupe', 'amber', 'mauve', 'blue')),
    default_minutes  int NOT NULL CHECK (default_minutes BETWEEN 10 AND 300),
    description      text CHECK (length(description) <= 1000),
    status           text NOT NULL CHECK (status IN ('active', 'archived')),
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    version          bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);

CREATE TABLE scheduling.templates (
    organization_id          uuid NOT NULL,
    id                       uuid NOT NULL,
    class_type_id            uuid NOT NULL,
    weekday                  smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
    local_start              time NOT NULL,
    minutes                  int NOT NULL CHECK (minutes BETWEEN 10 AND 300),
    instructor_membership_id uuid,
    room_id                  uuid,
    capacity                 int NOT NULL CHECK (capacity BETWEEN 1 AND 500),
    valid_from               date NOT NULL,
    valid_until              date,
    materialized_until       date,
    created_at               timestamptz NOT NULL,
    updated_at               timestamptz NOT NULL,
    version                  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, class_type_id) REFERENCES scheduling.class_types (organization_id, id),
    FOREIGN KEY (organization_id, room_id) REFERENCES scheduling.rooms (organization_id, id),
    FOREIGN KEY (organization_id, instructor_membership_id) REFERENCES organizations.memberships (organization_id, id),
    CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE scheduling.sessions (
    organization_id          uuid NOT NULL,
    id                       uuid NOT NULL,
    template_id              uuid,
    local_date               date NOT NULL,
    class_type_id            uuid NOT NULL,
    starts_at                timestamptz NOT NULL,
    ends_at                  timestamptz NOT NULL,
    instructor_membership_id uuid,
    room_id                  uuid,
    capacity                 int NOT NULL CHECK (capacity BETWEEN 1 AND 500),
    booked_count             int NOT NULL DEFAULT 0,
    next_waitlist_position   int NOT NULL DEFAULT 1,
    status                   text NOT NULL CHECK (status IN ('scheduled', 'cancelled')),
    created_at               timestamptz NOT NULL,
    updated_at               timestamptz NOT NULL,
    version                  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, template_id) REFERENCES scheduling.templates (organization_id, id),
    FOREIGN KEY (organization_id, class_type_id) REFERENCES scheduling.class_types (organization_id, id),
    FOREIGN KEY (organization_id, room_id) REFERENCES scheduling.rooms (organization_id, id),
    FOREIGN KEY (organization_id, instructor_membership_id) REFERENCES organizations.memberships (organization_id, id),
    CHECK (ends_at > starts_at),
    -- The capacity rule (docs/29 section 6.2): no update can overbook a session.
    CHECK (booked_count BETWEEN 0 AND capacity)
);
CREATE UNIQUE INDEX ux_sessions_occurrence ON scheduling.sessions (organization_id, template_id, local_date)
    WHERE template_id IS NOT NULL;
CREATE INDEX ix_sessions_time ON scheduling.sessions (organization_id, starts_at);

CREATE TABLE scheduling.pass_products (
    organization_id  uuid NOT NULL REFERENCES organizations.organizations (id),
    id               uuid NOT NULL,
    kind             text NOT NULL CHECK (kind IN ('punch_card', 'membership')),
    name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    entries          int CHECK (entries BETWEEN 1 AND 200),
    valid_days       int NOT NULL CHECK (valid_days BETWEEN 1 AND 730),
    weekly_cap       int CHECK (weekly_cap BETWEEN 1 AND 14),
    class_category   text CHECK (class_category ~ '^[a-z][a-z0-9_]{1,29}$'),
    price_agorot     int CHECK (price_agorot >= 0),
    status           text NOT NULL CHECK (status IN ('active', 'archived')),
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    version          bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    CHECK ((kind = 'punch_card' AND entries IS NOT NULL AND weekly_cap IS NULL)
        OR (kind = 'membership' AND entries IS NULL))
);

CREATE TABLE scheduling.passes (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    person_id        uuid NOT NULL,
    product_id       uuid NOT NULL,
    starts_on        date NOT NULL,
    ends_on          date NOT NULL,
    entries          int,                                  -- copied from the product for a punch card
    entries_used     int NOT NULL DEFAULT 0,
    note             text CHECK (length(note) <= 200),     -- cleared on erase
    status           text NOT NULL CHECK (status IN ('active', 'voided')),
    granted_by       uuid NOT NULL,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    version          bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, product_id) REFERENCES scheduling.pass_products (organization_id, id),
    FOREIGN KEY (organization_id, granted_by) REFERENCES organizations.memberships (organization_id, id),
    CHECK (ends_on >= starts_on),
    -- The entry rule (docs/29 section 5.4): no update can spend more entries than the card holds.
    CHECK (entries IS NULL OR entries_used BETWEEN 0 AND entries)
);
CREATE INDEX ix_passes_person ON scheduling.passes (organization_id, person_id, ends_on);

CREATE TABLE scheduling.bookings (
    organization_id    uuid NOT NULL,
    id                 uuid NOT NULL,
    session_id         uuid NOT NULL,
    person_id          uuid NOT NULL,
    status             text NOT NULL CHECK (status IN ('booked', 'waitlisted', 'cancelled', 'attended', 'no_show', 'removed', 'expired')),
    waitlist_position  int,
    late_cancel        boolean NOT NULL DEFAULT false,
    cancel_reason      text CHECK (cancel_reason IN ('self', 'staff', 'session_cancelled', 'no_valid_pass')),
    booked_by          uuid NOT NULL,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    version            bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, session_id) REFERENCES scheduling.sessions (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, booked_by) REFERENCES organizations.memberships (organization_id, id),
    CHECK (status <> 'waitlisted' OR waitlist_position IS NOT NULL)
);
CREATE UNIQUE INDEX ux_bookings_one_live ON scheduling.bookings (organization_id, session_id, person_id)
    WHERE status IN ('booked', 'waitlisted', 'attended', 'no_show');
CREATE INDEX ix_bookings_waitlist ON scheduling.bookings (organization_id, session_id, waitlist_position)
    WHERE status = 'waitlisted';
CREATE INDEX ix_bookings_person ON scheduling.bookings (organization_id, person_id, created_at);

CREATE TABLE scheduling.pass_uses (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    pass_id          uuid NOT NULL,
    booking_id       uuid NOT NULL,
    status           text NOT NULL CHECK (status IN ('held', 'returned')),
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    version          bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, pass_id) REFERENCES scheduling.passes (organization_id, id),
    FOREIGN KEY (organization_id, booking_id) REFERENCES scheduling.bookings (organization_id, id)
);
CREATE UNIQUE INDEX ux_pass_uses_one_per_booking ON scheduling.pass_uses (organization_id, booking_id);
CREATE INDEX ix_pass_uses_pass ON scheduling.pass_uses (organization_id, pass_id) WHERE status = 'held';

CREATE TABLE notifications.inbox_items (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    person_id        uuid NOT NULL,
    kind             text NOT NULL CHECK (kind ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
    data             jsonb NOT NULL DEFAULT '{}',          -- ids only, never names
    read_at          timestamptz,
    created_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE INDEX ix_inbox_person ON notifications.inbox_items (organization_id, person_id, created_at DESC);

-- No booking_policies row means the column defaults above; the first change inserts the row.

-- permissions (docs/29 section 8) ------------------------------------------

INSERT INTO authz.role_permissions (role_id, permission_key)
SELECT '00000000-0000-7000-8000-000000000001'::uuid, key
FROM unnest(ARRAY['schedule.view', 'schedule.manage', 'bookings.manage', 'attendance.mark', 'passes.view', 'passes.manage']) AS key
UNION ALL
SELECT '00000000-0000-7000-8000-000000000002'::uuid, key
FROM unnest(ARRAY['schedule.view', 'schedule.manage', 'bookings.manage', 'attendance.mark', 'passes.view', 'passes.manage']) AS key
UNION ALL
SELECT '00000000-0000-7000-8000-000000000003'::uuid, key
FROM unnest(ARRAY['schedule.view', 'bookings.manage', 'attendance.mark', 'passes.view']) AS key
UNION ALL
SELECT '00000000-0000-7000-8000-000000000004'::uuid, key
FROM unnest(ARRAY['schedule.view']) AS key;

-- grants -------------------------------------------------------------------

GRANT USAGE ON SCHEMA scheduling, notifications TO $app_role$;
GRANT SELECT, INSERT, UPDATE ON scheduling.booking_policies, scheduling.rooms, scheduling.class_types,
    scheduling.templates, scheduling.sessions, scheduling.pass_products, scheduling.passes,
    scheduling.bookings, scheduling.pass_uses TO $app_role$;
GRANT DELETE ON scheduling.sessions TO $app_role$;      -- unbooked future sessions of a changed template
GRANT SELECT, INSERT, UPDATE ON notifications.inbox_items TO $app_role$;

-- The daily job (docs/29 section 11) runs as the platform role across studios.
GRANT USAGE ON SCHEMA scheduling, notifications TO $platform_role$;
GRANT SELECT ON ALL TABLES IN SCHEMA scheduling, notifications TO $platform_role$;
GRANT INSERT ON scheduling.sessions TO $platform_role$;
GRANT UPDATE (materialized_until, updated_at, version) ON scheduling.templates TO $platform_role$;
GRANT UPDATE (status, updated_at, version) ON scheduling.bookings TO $platform_role$;
GRANT INSERT ON notifications.inbox_items TO $platform_role$;

-- row-level security -------------------------------------------------------

ALTER TABLE scheduling.booking_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.class_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.pass_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.pass_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications.inbox_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_policies_app ON scheduling.booking_policies TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY rooms_app ON scheduling.rooms TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY class_types_app ON scheduling.class_types TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY templates_app ON scheduling.templates TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY sessions_app ON scheduling.sessions TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY pass_products_app ON scheduling.pass_products TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY passes_app ON scheduling.passes TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY bookings_app ON scheduling.bookings TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY pass_uses_app ON scheduling.pass_uses TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY inbox_items_app ON notifications.inbox_items TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

-- Operators and the daily job see every tenant; their grants above limit what they may change.
CREATE POLICY booking_policies_platform ON scheduling.booking_policies TO $platform_role$ USING (true);
CREATE POLICY rooms_platform ON scheduling.rooms TO $platform_role$ USING (true);
CREATE POLICY class_types_platform ON scheduling.class_types TO $platform_role$ USING (true);
CREATE POLICY templates_platform ON scheduling.templates TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY sessions_platform ON scheduling.sessions TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY pass_products_platform ON scheduling.pass_products TO $platform_role$ USING (true);
CREATE POLICY passes_platform ON scheduling.passes TO $platform_role$ USING (true);
CREATE POLICY bookings_platform ON scheduling.bookings TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY pass_uses_platform ON scheduling.pass_uses TO $platform_role$ USING (true);
CREATE POLICY inbox_items_platform ON notifications.inbox_items TO $platform_role$ USING (true) WITH CHECK (true);

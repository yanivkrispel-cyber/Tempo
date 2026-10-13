-- booked_count is the capacity counter. A booking increments it with a
-- conditional UPDATE (booked_count < capacity) in the same transaction that
-- inserts the booking, so two bookings for the last seat conflict on this row.
CREATE TABLE IF NOT EXISTS scheduling.class_sessions (
    organization_id uuid NOT NULL,
    id uuid NOT NULL,
    room_id uuid NOT NULL,
    title text NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    capacity integer NOT NULL,
    booked_count integer NOT NULL DEFAULT 0,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT class_sessions_pkey PRIMARY KEY (organization_id, id),
    CONSTRAINT class_sessions_room_fkey FOREIGN KEY (organization_id, room_id)
        REFERENCES scheduling.rooms (organization_id, id),
    CONSTRAINT class_sessions_capacity_check CHECK (capacity > 0),
    CONSTRAINT class_sessions_booked_check CHECK (booked_count >= 0 AND booked_count <= capacity),
    CONSTRAINT class_sessions_time_check CHECK (ends_at > starts_at)
);

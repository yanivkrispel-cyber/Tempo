-- The composite foreign keys make a cross-tenant booking unrepresentable:
-- (organization_id, session_id) and (organization_id, membership_id) must
-- both exist under the same organization.
CREATE TABLE IF NOT EXISTS scheduling.bookings (
    organization_id uuid NOT NULL,
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT bookings_pkey PRIMARY KEY (organization_id, id),
    CONSTRAINT bookings_session_member_key UNIQUE (organization_id, session_id, membership_id),
    CONSTRAINT bookings_session_fkey FOREIGN KEY (organization_id, session_id)
        REFERENCES scheduling.class_sessions (organization_id, id),
    CONSTRAINT bookings_membership_fkey FOREIGN KEY (organization_id, membership_id)
        REFERENCES organizations.memberships (organization_id, id)
);

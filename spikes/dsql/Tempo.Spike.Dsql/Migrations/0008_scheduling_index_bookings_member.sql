CREATE INDEX $async$ IF NOT EXISTS bookings_member_idx
    ON scheduling.bookings (organization_id, membership_id);

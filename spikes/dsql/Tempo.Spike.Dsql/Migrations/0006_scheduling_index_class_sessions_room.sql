CREATE INDEX $async$ IF NOT EXISTS class_sessions_room_idx
    ON scheduling.class_sessions (organization_id, room_id, starts_at);

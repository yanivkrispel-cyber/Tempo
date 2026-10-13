CREATE INDEX $async$ IF NOT EXISTS class_sessions_starts_idx
    ON scheduling.class_sessions (organization_id, starts_at);

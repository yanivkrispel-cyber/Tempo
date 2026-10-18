-- Rooms with spots (docs/33_Studio_Experience_LLD.md section 3, step E2). A room may carry a layout: a grid of rows
-- and columns, the window's side and a mirror wall at the front. Each spot (a reformer, a mat, a bike) sits in one
-- cell. When spot selection is on, a booked place also holds one spot; the partial unique index below is what makes
-- two live bookings on one spot of one session impossible. A member's usual spot per room is a preference row.
ALTER TABLE scheduling.rooms
    ADD COLUMN spot_selection boolean NOT NULL DEFAULT false,
    ADD COLUMN layout_rows    smallint CHECK (layout_rows BETWEEN 1 AND 12),
    ADD COLUMN layout_cols    smallint CHECK (layout_cols BETWEEN 1 AND 12),
    ADD COLUMN window_side    text CHECK (window_side IN ('start', 'end', 'back')),
    ADD COLUMN mirror_front   boolean NOT NULL DEFAULT false;

CREATE TABLE scheduling.room_spots (
    organization_id uuid NOT NULL,
    room_id         uuid NOT NULL,
    id              uuid NOT NULL,
    label           text NOT NULL CHECK (length(label) BETWEEN 1 AND 8),
    row_index       smallint NOT NULL CHECK (row_index BETWEEN 0 AND 11),
    col_index       smallint NOT NULL CHECK (col_index BETWEEN 0 AND 11),
    kind            text NOT NULL CHECK (kind IN ('reformer', 'mat', 'bike', 'tower', 'chair', 'place')),
    status          text NOT NULL CHECK (status IN ('active', 'maintenance', 'archived')),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, room_id) REFERENCES scheduling.rooms (organization_id, id)
);
CREATE UNIQUE INDEX ux_room_spots_cell ON scheduling.room_spots (organization_id, room_id, row_index, col_index)
    WHERE status <> 'archived';
CREATE UNIQUE INDEX ux_room_spots_label ON scheduling.room_spots (organization_id, room_id, lower(label))
    WHERE status <> 'archived';

ALTER TABLE scheduling.bookings ADD COLUMN spot_id uuid;
ALTER TABLE scheduling.bookings ADD CONSTRAINT bookings_spot_fk
    FOREIGN KEY (organization_id, spot_id) REFERENCES scheduling.room_spots (organization_id, id);
CREATE UNIQUE INDEX ux_bookings_session_spot ON scheduling.bookings (organization_id, session_id, spot_id)
    WHERE spot_id IS NOT NULL AND status IN ('booked', 'attended', 'no_show');

CREATE TABLE scheduling.spot_preferences (
    organization_id uuid NOT NULL,
    person_id       uuid NOT NULL,
    room_id         uuid NOT NULL,
    spot_id         uuid NOT NULL,
    updated_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id, room_id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, room_id) REFERENCES scheduling.rooms (organization_id, id),
    FOREIGN KEY (organization_id, spot_id) REFERENCES scheduling.room_spots (organization_id, id)
);

ALTER TABLE scheduling.room_spots ENABLE ROW LEVEL SECURITY;
CREATE POLICY room_spots_app ON scheduling.room_spots TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

ALTER TABLE scheduling.spot_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY spot_preferences_app ON scheduling.spot_preferences TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON scheduling.room_spots TO $app_role$;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.spot_preferences TO $app_role$;

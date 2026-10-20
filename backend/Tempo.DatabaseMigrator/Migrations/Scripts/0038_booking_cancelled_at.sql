-- When a booking was cancelled (#395 review, board #404 K1): the "a place opened up" story card follows the moment a
-- place was given up, not any later edit of the cancelled row (a merge or an erase touches updated_at too). Every
-- path that cancels sets the status, so a trigger stamps the time once, whatever the code path. 0037 is the rate
-- counters' (#419).
ALTER TABLE scheduling.bookings ADD COLUMN cancelled_at timestamptz;
UPDATE scheduling.bookings SET cancelled_at = updated_at WHERE status = 'cancelled';

CREATE FUNCTION scheduling.stamp_cancelled_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        NEW.cancelled_at := now();
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER bookings_stamp_cancelled_at
    BEFORE UPDATE OF status ON scheduling.bookings
    FOR EACH ROW EXECUTE FUNCTION scheduling.stamp_cancelled_at();

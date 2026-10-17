-- A weekly class created by mistake can end before its first day (day board #232, P2 finding F5): the API stores
-- valid_until as the day before valid_from, an empty range that materializes nothing. Only a class that never took a
-- booking may do that; the API refuses the rest with 409 template.has_bookings.
ALTER TABLE scheduling.templates DROP CONSTRAINT templates_check;
ALTER TABLE scheduling.templates ADD CONSTRAINT templates_valid_range
    CHECK (valid_until IS NULL OR valid_until >= valid_from - 1);

-- Phase 4 step 7, studio notification templates (docs/30_Communications_LLD.md section 13 step 7; day board #208,
-- T2). The platform defaults stay in code; a studio's own words are rows of notifications.templates (0014). The
-- inbox item keeps the title and body rendered when it was written, so a later template change never rewrites
-- what a member already received. Older items keep NULL and the apps show their own text for the kind.

ALTER TABLE notifications.inbox_items ADD COLUMN title text CHECK (length(title) <= 400);
ALTER TABLE notifications.inbox_items ADD COLUMN body text CHECK (length(body) <= 8000);

-- A studio writes its own versions; status moves active -> retired and nothing else changes on a row.
GRANT INSERT ON notifications.templates TO $app_role$;
GRANT UPDATE (status) ON notifications.templates TO $app_role$;

-- Writes only for the studio itself; the SELECT policy of 0014 still lets it read the platform defaults.
CREATE POLICY templates_app_insert ON notifications.templates FOR INSERT TO $app_role$
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY templates_app_update ON notifications.templates FOR UPDATE TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

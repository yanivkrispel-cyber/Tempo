-- Owner reports (docs/32 section 3, R-1, day board #253): the reports.view permission for the owner and admin
-- system roles. The reports read existing tables under their RLS policies, so nothing else changes (R-5).
INSERT INTO authz.role_permissions (role_id, permission_key) VALUES
    ('00000000-0000-7000-8000-000000000001'::uuid, 'reports.view'),
    ('00000000-0000-7000-8000-000000000002'::uuid, 'reports.view');

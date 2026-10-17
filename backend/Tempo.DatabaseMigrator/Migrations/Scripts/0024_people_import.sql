-- Member import from a file (docs/34 section 3, I-1, day board #321): the people.import permission for the owner and
-- admin system roles. The import writes people, contact points, duplicate candidates and audit rows that already
-- exist, under their RLS policies, so nothing else changes.
INSERT INTO authz.role_permissions (role_id, permission_key) VALUES
    ('00000000-0000-7000-8000-000000000001'::uuid, 'people.import'),
    ('00000000-0000-7000-8000-000000000002'::uuid, 'people.import');

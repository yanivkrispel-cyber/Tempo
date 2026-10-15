-- Gives every live membership that has no live role assignment the system
-- role named in memberships.role (docs/27 section 3.3).
--
-- 0005 backfilled the memberships that existed when it ran. Until the API
-- writes assignments itself (the same deploy as this script), a studio created
-- or a member who joined in between had none, and permission evaluation would
-- deny them everything. Idempotent: a membership that already has a live
-- assignment is left alone.

INSERT INTO authz.role_assignments (organization_id, id, membership_id, role_id, status, created_at, updated_at)
SELECT m.organization_id,
       uuidv7(),
       m.id,
       CASE m.role
           WHEN 'owner' THEN '00000000-0000-7000-8000-000000000001'::uuid
           WHEN 'admin' THEN '00000000-0000-7000-8000-000000000002'::uuid
           WHEN 'staff' THEN '00000000-0000-7000-8000-000000000003'::uuid
           ELSE '00000000-0000-7000-8000-000000000004'::uuid
       END,
       'active',
       now(),
       now()
FROM organizations.memberships m
WHERE m.status <> 'removed'
  AND NOT EXISTS (
      SELECT 1 FROM authz.role_assignments a
      WHERE a.organization_id = m.organization_id AND a.membership_id = m.id AND a.status = 'active'
  );

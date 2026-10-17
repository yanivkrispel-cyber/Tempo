-- A role assignment may only use a system role or a role of its own studio (#245, from #124 item 4). role_id is a
-- single-column FK to authz.roles, so once custom roles (rows with an organization_id) exist, an assignment in
-- studio A could otherwise point at studio B's role. The check reads the role as the function's owner, so the
-- caller's row-level security cannot hide another studio's role from it.
CREATE FUNCTION authz.role_assignment_in_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    role_organization uuid;
BEGIN
    SELECT r.organization_id INTO role_organization FROM authz.roles r WHERE r.id = NEW.role_id;
    IF role_organization IS NOT NULL AND role_organization <> NEW.organization_id THEN
        RAISE EXCEPTION 'a role assignment must use a system role or a role of its own studio'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'role_assignments_role_in_scope';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER role_assignments_role_in_scope
    BEFORE INSERT OR UPDATE OF role_id, organization_id ON authz.role_assignments
    FOR EACH ROW EXECUTE FUNCTION authz.role_assignment_in_scope();

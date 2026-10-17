-- The operator removes a suspended studio (docs/32 section 10, A-3, day board #253, P2 F4). The platform role gets
-- no DELETE on any table: it may only call this function, which runs as its owner (the migrator, exempt from RLS),
-- refuses a studio that is not suspended, and deletes every row whose organization_id is the studio's, then the
-- studio itself. The tables are read from the catalog, so a tenant table added later is covered without a change
-- here; the order follows the foreign keys by retrying a table whose rows are still referenced. The API checks the
-- suspension age and the typed name, and writes the platform.organization.deleted audit row after the call.
CREATE FUNCTION platform_admin.delete_organization(target uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    remaining text[];
    tenant_table text;
    progressed boolean;
    removed bigint;
    total bigint := 0;
BEGIN
    PERFORM 1 FROM organizations.organizations WHERE id = target AND status = 'suspended' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'organization % is not suspended', target USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;

    -- The one tenant table without its own organization_id: the permissions of the studio's custom roles.
    DELETE FROM authz.role_permissions p USING authz.roles r WHERE r.id = p.role_id AND r.organization_id = target;
    GET DIAGNOSTICS removed = ROW_COUNT;
    total := total + removed;

    SELECT array_agg(format('%I.%I', n.nspname, c.relname) ORDER BY n.nspname, c.relname)
    INTO remaining
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%';

    WHILE coalesce(cardinality(remaining), 0) > 0 LOOP
        progressed := false;
        FOREACH tenant_table IN ARRAY remaining LOOP
            BEGIN
                EXECUTE format('DELETE FROM %s WHERE organization_id = $1', tenant_table) USING target;
                GET DIAGNOSTICS removed = ROW_COUNT;
                total := total + removed;
                remaining := array_remove(remaining, tenant_table);
                progressed := true;
            EXCEPTION WHEN foreign_key_violation THEN
                -- Rows of another tenant table still point here; try again on the next pass.
                NULL;
            END;
        END LOOP;
        IF NOT progressed THEN
            RAISE EXCEPTION 'no delete order for %', remaining USING ERRCODE = 'foreign_key_violation';
        END IF;
    END LOOP;

    DELETE FROM organizations.organizations WHERE id = target;
    RETURN total + 1;
END
$$;

REVOKE ALL ON FUNCTION platform_admin.delete_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin.delete_organization(uuid) TO $platform_role$;

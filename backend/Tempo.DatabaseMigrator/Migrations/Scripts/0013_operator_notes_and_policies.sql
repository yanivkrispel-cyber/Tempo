-- Q11 low findings (#124), the schema part.

-- Operator free text (the reason for a suspension, the support ticket of a forced transfer) leaves the
-- studio's audit log, which owners and admins can read, and lives here, where only the platform role
-- reaches. The audit event carries the note's id.
CREATE TABLE platform_admin.operator_notes (
    id              uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    operator_id     uuid NOT NULL,
    action          text NOT NULL,
    reason          text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    ticket          text CHECK (length(ticket) BETWEEN 1 AND 100),
    created_at      timestamptz NOT NULL
);
CREATE INDEX ix_operator_notes_org ON platform_admin.operator_notes (organization_id, created_at DESC);
GRANT SELECT, INSERT ON platform_admin.operator_notes TO $platform_role$;

-- The two FOR ALL policies whose USING carried a self clause (a member sees their own rows in every
-- studio) become a SELECT policy with that clause and write policies with the tenant clause only, so a
-- future write without the tenant filter cannot reach the caller's rows in another studio.
DROP POLICY role_assignments_app ON authz.role_assignments;
CREATE POLICY role_assignments_app_select ON authz.role_assignments FOR SELECT TO $app_role$
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR EXISTS (
        SELECT 1 FROM organizations.memberships m
        WHERE m.organization_id = role_assignments.organization_id
          AND m.id = role_assignments.membership_id
          AND m.user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
    )
);
CREATE POLICY role_assignments_app_insert ON authz.role_assignments FOR INSERT TO $app_role$
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY role_assignments_app_update ON authz.role_assignments FOR UPDATE TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY role_assignments_app_delete ON authz.role_assignments FOR DELETE TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

DROP POLICY ownership_transfers_app ON organizations.ownership_transfers;
CREATE POLICY ownership_transfers_app_select ON organizations.ownership_transfers FOR SELECT TO $app_role$
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR EXISTS (
        SELECT 1 FROM organizations.memberships m
        WHERE m.organization_id = ownership_transfers.organization_id
          AND m.id IN (ownership_transfers.from_membership_id, ownership_transfers.to_membership_id)
          AND m.user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
    )
);
CREATE POLICY ownership_transfers_app_insert ON organizations.ownership_transfers FOR INSERT TO $app_role$
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY ownership_transfers_app_update ON organizations.ownership_transfers FOR UPDATE TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY ownership_transfers_app_delete ON organizations.ownership_transfers FOR DELETE TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

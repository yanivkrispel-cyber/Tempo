-- Row-level security on the identity tables (#561; docs/security/review-2026-11.md, SR-10). Until now the app role
-- could read, change and delete every row of identity.user_accounts and identity.external_identities: one query
-- without a predicate, or an injection, would list every account's email across all studios, and an UPDATE bug could
-- link a sign-in (issuer, subject) to another account. From here on:
--   * the app role sees, inserts, updates and deletes only the caller's own account (app.user_account_id) and that
--     account's sign-in links;
--   * the two reads that need more go through SECURITY DEFINER functions owned by the migrator (exempt from RLS, like
--     the 0002 lookups), each returning only what its caller needs;
--   * the app role may update only the columns the code updates, and never updates or deletes a sign-in link (account
--     deletion removes them through the ON DELETE CASCADE of 0022, which row-level security does not apply to);
--   * the platform role still reads every account (operator console: a studio owner's email, the account count) and
--     no longer reads sign-in links, which it never used.
-- RLS is enabled, not forced, as everywhere: the migrator owns both tables and stays exempt.

ALTER TABLE identity.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.external_identities ENABLE ROW LEVEL SECURITY;

-- Revoking the table-wide UPDATE also drops any column grants, so the column list below is the whole of it:
-- AccountService.UpdateAsync (display_name, locale) and RefreshAsync (email, email_verified, mfa_enabled,
-- identity_synced_at), both with updated_at and version. id, status and created_at are never changed by the app.
REVOKE UPDATE ON identity.user_accounts FROM $app_role$;
GRANT UPDATE (email, email_verified, mfa_enabled, display_name, locale, identity_synced_at, updated_at, version)
    ON identity.user_accounts TO $app_role$;
REVOKE UPDATE, DELETE ON identity.external_identities FROM $app_role$;
REVOKE SELECT ON identity.external_identities FROM $platform_role$;

-- Account routes and provisioning set app.user_account_id to the account first (AccountService creates the row with
-- its new id already set), so one rule covers read, insert, update and delete. A missing setting reads as NULL and
-- matches nothing.
CREATE POLICY user_accounts_app ON identity.user_accounts TO $app_role$
USING (id = nullif(current_setting('app.user_account_id', true), '')::uuid)
WITH CHECK (id = nullif(current_setting('app.user_account_id', true), '')::uuid);

CREATE POLICY external_identities_app ON identity.external_identities TO $app_role$
USING (user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid)
WITH CHECK (user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid);

-- PlatformService reads the owner's email for each studio and counts accounts; its grants allow nothing more.
CREATE POLICY user_accounts_platform ON identity.user_accounts FOR SELECT TO $platform_role$ USING (true);

-- The account behind a sign-in, before its id is known: AccountDirectory on every request, AccountService's session
-- start and its re-read after a unique-key race, and account deletion. Only the one account linked to that
-- (issuer, subject) comes back, and the subject is the verified token's `sub`.
CREATE FUNCTION identity.find_account_by_external_identity(issuer text, subject text)
RETURNS TABLE (
    id uuid,
    email text,
    email_verified boolean,
    display_name text,
    locale text,
    status text,
    mfa_enabled boolean,
    identity_synced_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT a.id, a.email, a.email_verified, a.display_name, a.locale, a.status, a.mfa_enabled, a.identity_synced_at
    FROM identity.external_identities e
    JOIN identity.user_accounts a ON a.id = e.user_account_id
    WHERE e.issuer = find_account_by_external_identity.issuer
      AND e.subject = find_account_by_external_identity.subject
$$;

-- Names and emails of other accounts for a studio's screens (AccountProfiles: member list, invitation list and the
-- inviter on an invitation preview, audit log actors). Of the ids asked for, it returns the caller's own account and
-- accounts with a membership, in any status, in the current tenant (app.organization_id), which is exactly the set
-- memberships_app already shows. Removed members stay in, so the audit log keeps their names; an account in another
-- studio never comes back, even when it shares a different studio with the caller.
CREATE FUNCTION identity.find_account_profiles(ids uuid[])
RETURNS TABLE (id uuid, email text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT a.id, a.email, a.display_name
    FROM identity.user_accounts a
    WHERE a.id = ANY (find_account_profiles.ids)
      AND (
          a.id = nullif(current_setting('app.user_account_id', true), '')::uuid
          OR EXISTS (
              SELECT 1
              FROM organizations.memberships m
              WHERE m.organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
                AND m.user_account_id = a.id
          )
      )
$$;

REVOKE ALL ON FUNCTION identity.find_account_by_external_identity(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.find_account_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.find_account_by_external_identity(text, text) TO $app_role$;
GRANT EXECUTE ON FUNCTION identity.find_account_profiles(uuid[]) TO $app_role$;

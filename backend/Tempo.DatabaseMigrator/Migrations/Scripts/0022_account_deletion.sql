-- A person deletes their own login (docs/32 section 9, A-1 and A-2, day board #253, P2 F6). The API ends every
-- membership first, then deletes the identity.user_accounts row, and the foreign keys do the rest in the same
-- transaction: the sign-in links and join attempts go, and every row that only pointed at the login keeps its
-- history with the account cleared. A membership row stays (bookings, passes and messages point at it), so its
-- account may be null once it is removed, and only then.
ALTER TABLE identity.external_identities DROP CONSTRAINT external_identities_user_account_id_fkey,
    ADD CONSTRAINT external_identities_user_account_id_fkey
        FOREIGN KEY (user_account_id) REFERENCES identity.user_accounts (id) ON DELETE CASCADE;

ALTER TABLE identity.join_attempts DROP CONSTRAINT join_attempts_user_account_id_fkey,
    ADD CONSTRAINT join_attempts_user_account_id_fkey
        FOREIGN KEY (user_account_id) REFERENCES identity.user_accounts (id) ON DELETE CASCADE;

ALTER TABLE organizations.memberships ALTER COLUMN user_account_id DROP NOT NULL,
    DROP CONSTRAINT memberships_user_account_id_fkey,
    ADD CONSTRAINT memberships_user_account_id_fkey
        FOREIGN KEY (user_account_id) REFERENCES identity.user_accounts (id) ON DELETE SET NULL,
    ADD CONSTRAINT memberships_account_or_removed CHECK (user_account_id IS NOT NULL OR status = 'removed');

ALTER TABLE organizations.organizations ALTER COLUMN created_by_user_id DROP NOT NULL,
    DROP CONSTRAINT organizations_created_by_user_id_fkey,
    ADD CONSTRAINT organizations_created_by_user_id_fkey
        FOREIGN KEY (created_by_user_id) REFERENCES identity.user_accounts (id) ON DELETE SET NULL;

ALTER TABLE people.people DROP CONSTRAINT people_user_account_id_fkey,
    ADD CONSTRAINT people_user_account_id_fkey
        FOREIGN KEY (user_account_id) REFERENCES identity.user_accounts (id) ON DELETE SET NULL;

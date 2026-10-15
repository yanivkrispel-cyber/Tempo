-- Whether the account has MFA set up in Cognito (docs/27 section 3.6, A-5).
-- POST /session reads it with AdminGetUser on every new sign-in, like email and
-- verification. With TEMPO_REQUIRE_OWNER_MFA on, owner and admin routes refuse
-- an account without MFA (403 auth.mfa_required). Off until the pilot.

ALTER TABLE identity.user_accounts ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false;

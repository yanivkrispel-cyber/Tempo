-- Thin billing (docs/28_Billing_and_Entitlements_LLD.md section 7, Kris's plan of 2026-10-15): plans as
-- immutable versions with entitlements, one billing account and one live subscription per studio, an
-- append-only subscription history and operator overrides. No payment provider yet: every studio is on the
-- free `pilot` plan with an ACTIVE subscription (a trial would restrict pilots after 30 days, since nothing
-- pays under the manual provider). Entitlements are computed on read from the plan and the overrides.

CREATE SCHEMA billing;

CREATE TABLE billing.plans (
    id            uuid PRIMARY KEY,
    key           text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,29}$'),
    display_name  text NOT NULL,
    created_at    timestamptz NOT NULL
);

CREATE TABLE billing.plan_versions (
    id            uuid PRIMARY KEY,
    plan_id       uuid NOT NULL REFERENCES billing.plans (id),
    version       int NOT NULL,
    price_minor   bigint NOT NULL CHECK (price_minor >= 0),
    currency      char(3) NOT NULL DEFAULT 'ILS',
    interval      text NOT NULL CHECK (interval IN ('month', 'year')),
    is_public     boolean NOT NULL,
    created_at    timestamptz NOT NULL,
    UNIQUE (plan_id, version)
);

CREATE TABLE billing.plan_entitlements (
    plan_version_id uuid NOT NULL REFERENCES billing.plan_versions (id),
    key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    value           jsonb NOT NULL,
    PRIMARY KEY (plan_version_id, key)
);

CREATE TABLE billing.billing_accounts (
    organization_id  uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    billing_email    text CHECK (length(billing_email) <= 254),
    legal_name       text CHECK (length(legal_name) <= 120),
    business_id      text CHECK (business_id ~ '^[0-9]{9}$'),
    provider         text NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual')),
    card_last4       text,
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    version          bigint NOT NULL DEFAULT 0
);

CREATE TABLE billing.subscriptions (
    organization_id       uuid NOT NULL REFERENCES organizations.organizations (id),
    id                    uuid NOT NULL,
    plan_version_id       uuid NOT NULL REFERENCES billing.plan_versions (id),
    state                 text NOT NULL CHECK (state IN ('trialing', 'active', 'past_due', 'grace', 'restricted', 'canceled')),
    trial_ends_at         timestamptz,
    current_period_start  timestamptz,
    current_period_end    timestamptz,
    grace_ends_at         timestamptz,
    cancel_at_period_end  boolean NOT NULL DEFAULT false,
    created_at            timestamptz NOT NULL,
    updated_at            timestamptz NOT NULL,
    version               bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX ux_subscriptions_one_live ON billing.subscriptions (organization_id) WHERE state <> 'canceled';

CREATE TABLE billing.subscription_events (          -- append-only
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    subscription_id  uuid NOT NULL,
    from_state       text,
    to_state         text NOT NULL,
    cause            text NOT NULL,
    actor_type       text NOT NULL CHECK (actor_type IN ('system', 'user', 'operator')),
    actor_id         uuid,
    occurred_at      timestamptz NOT NULL,
    data             jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, subscription_id) REFERENCES billing.subscriptions (organization_id, id)
);

CREATE TABLE billing.entitlement_overrides (
    organization_id      uuid NOT NULL REFERENCES organizations.organizations (id),
    key                  text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    value                jsonb NOT NULL,
    reason               text NOT NULL,
    ends_at              timestamptz,
    created_by_operator  uuid NOT NULL,
    created_at           timestamptz NOT NULL,
    PRIMARY KEY (organization_id, key)
);

-- The pilot plan (B-4): free, monthly, not public, generous limits.
INSERT INTO billing.plans (id, key, display_name, created_at) VALUES
    ('00000000-0000-7000-8000-0000000000b1', 'pilot', 'פיילוט', now());
INSERT INTO billing.plan_versions (id, plan_id, version, price_minor, currency, interval, is_public, created_at) VALUES
    ('00000000-0000-7000-8000-0000000000b2', '00000000-0000-7000-8000-0000000000b1', 1, 0, 'ILS', 'month', false, now());
INSERT INTO billing.plan_entitlements (plan_version_id, key, value) VALUES
    ('00000000-0000-7000-8000-0000000000b2', 'staff.max', '10'),
    ('00000000-0000-7000-8000-0000000000b2', 'rooms.max', '20'),
    ('00000000-0000-7000-8000-0000000000b2', 'class_types.max', '50');

-- Every existing studio: a manual billing account and an active pilot subscription.
INSERT INTO billing.billing_accounts (organization_id, created_at, updated_at)
SELECT id, now(), now() FROM organizations.organizations;

INSERT INTO billing.subscriptions (organization_id, id, plan_version_id, state, current_period_start, current_period_end, created_at, updated_at)
SELECT id, gen_random_uuid(), '00000000-0000-7000-8000-0000000000b2', 'active', now(), now() + interval '1 month', now(), now()
FROM organizations.organizations;

INSERT INTO billing.subscription_events (organization_id, id, subscription_id, from_state, to_state, cause, actor_type, occurred_at)
SELECT organization_id, gen_random_uuid(), id, NULL, 'active', 'pilot_backfill', 'system', now()
FROM billing.subscriptions;

-- permissions (docs/28 section 8) -----------------------------------------

INSERT INTO authz.role_permissions (role_id, permission_key) VALUES
    ('00000000-0000-7000-8000-000000000001', 'billing.view'),
    ('00000000-0000-7000-8000-000000000001', 'billing.manage'),
    ('00000000-0000-7000-8000-000000000002', 'billing.view');

-- grants -------------------------------------------------------------------

GRANT USAGE ON SCHEMA billing TO $app_role$;
GRANT SELECT ON billing.plans, billing.plan_versions, billing.plan_entitlements TO $app_role$;
GRANT SELECT, INSERT ON billing.billing_accounts, billing.subscriptions, billing.subscription_events TO $app_role$;
GRANT UPDATE (billing_email, legal_name, business_id, updated_at, version) ON billing.billing_accounts TO $app_role$;
GRANT SELECT ON billing.entitlement_overrides TO $app_role$;

GRANT USAGE ON SCHEMA billing TO $platform_role$;
GRANT SELECT ON ALL TABLES IN SCHEMA billing TO $platform_role$;
GRANT INSERT, UPDATE ON billing.subscriptions TO $platform_role$;
GRANT INSERT ON billing.subscription_events TO $platform_role$;
GRANT INSERT, UPDATE, DELETE ON billing.entitlement_overrides TO $platform_role$;

-- row-level security (plans are global and readable by everyone) ------------

ALTER TABLE billing.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.entitlement_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_accounts_app ON billing.billing_accounts TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
-- An account route (GET /me) reads the subscription state of each of the caller's studios.
CREATE POLICY subscriptions_app ON billing.subscriptions TO $app_role$
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR EXISTS (
        SELECT 1 FROM organizations.memberships m
        WHERE m.organization_id = subscriptions.organization_id
          AND m.user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
    )
)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY subscription_events_app ON billing.subscription_events TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE POLICY entitlement_overrides_app ON billing.entitlement_overrides TO $app_role$
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR EXISTS (
        SELECT 1 FROM organizations.memberships m
        WHERE m.organization_id = entitlement_overrides.organization_id
          AND m.user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
    )
);

CREATE POLICY billing_accounts_platform ON billing.billing_accounts TO $platform_role$ USING (true);
CREATE POLICY subscriptions_platform ON billing.subscriptions TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY subscription_events_platform ON billing.subscription_events TO $platform_role$ USING (true) WITH CHECK (true);
CREATE POLICY entitlement_overrides_platform ON billing.entitlement_overrides TO $platform_role$ USING (true) WITH CHECK (true);

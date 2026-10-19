-- Studio marketing, stage B (docs/37 section 8.8, board #380 MK7): events and workshops on one-off sessions, a
-- booking "to pay at the studio" when no pass is needed, the studio's Instagram handle for member cards (M-15), the
-- bring-a-friend reward (M-17) with one reward per friend, and the members' new notification group `celebrations`
-- (milestones and referral rewards).

-- An event is a one-off session with these fields (section 8.4); pass_required = false books without a pass.
ALTER TABLE scheduling.sessions ADD COLUMN event_title text CHECK (char_length(event_title) BETWEEN 1 AND 60);
ALTER TABLE scheduling.sessions ADD COLUMN event_description text CHECK (char_length(event_description) <= 600);
ALTER TABLE scheduling.sessions ADD COLUMN event_price_agorot int CHECK (event_price_agorot >= 0);
ALTER TABLE scheduling.sessions ADD COLUMN pass_required boolean NOT NULL DEFAULT true;
ALTER TABLE scheduling.bookings ADD COLUMN to_pay_at_studio boolean NOT NULL DEFAULT false;

-- The studio's handle on member cards (M-15) and the referral reward product (M-17), one of its own products.
ALTER TABLE organizations.public_pages ADD COLUMN instagram_handle text CHECK (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$');
ALTER TABLE organizations.public_pages ADD COLUMN referral_reward_product_id uuid;
ALTER TABLE organizations.public_pages ADD CONSTRAINT public_pages_referral_reward_product
    FOREIGN KEY (organization_id, referral_reward_product_id) REFERENCES scheduling.pass_products (organization_id, id);

-- One reward per friend (section 8.5); the monthly cap of 10 per referrer is counted from these rows.
CREATE TABLE marketing.referral_rewards (
    organization_id        uuid NOT NULL REFERENCES organizations.organizations (id),
    friend_membership_id   uuid NOT NULL,
    referrer_membership_id uuid NOT NULL,
    pass_id                uuid NOT NULL,
    rewarded_at            timestamptz NOT NULL,
    PRIMARY KEY (organization_id, friend_membership_id),
    FOREIGN KEY (organization_id, friend_membership_id) REFERENCES organizations.memberships (organization_id, id),
    FOREIGN KEY (organization_id, referrer_membership_id) REFERENCES organizations.memberships (organization_id, id),
    FOREIGN KEY (organization_id, pass_id) REFERENCES scheduling.passes (organization_id, id)
);
CREATE INDEX ix_referral_rewards_referrer ON marketing.referral_rewards (organization_id, referrer_membership_id, rewarded_at);

ALTER TABLE marketing.referral_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_rewards_app ON marketing.referral_rewards TO $app_role$
USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
GRANT SELECT, INSERT ON marketing.referral_rewards TO $app_role$;

-- Milestones and referral rewards are a group the member can switch off (default on), next to the existing three.
ALTER TABLE notifications.preferences DROP CONSTRAINT preferences_group_check;
ALTER TABLE notifications.preferences ADD CONSTRAINT preferences_group_check
    CHECK ("group" IN ('bookings', 'reminders', 'studio', 'celebrations'));

-- Share links by intent (board #404, SL-1 to SL-10, SK1): a marketing link leads to one target, a session, the
-- studio's week, an offer or the prices; a member's invite may show her first name (SL-8); a studio lists some of
-- its products publicly, in its own order, with offers marked for newcomers (SL-4, SL-5).

-- A link's target (SL-1). `target_id` is set exactly for `session` and `offer`. A session target keeps its
-- `session_id` (the existing foreign key to this studio's sessions) equal to `target_id`; an offer target's product
-- is this studio's own through the stored column `target_product_id`.
ALTER TABLE marketing.links ADD COLUMN target_kind text NOT NULL DEFAULT 'schedule'
    CHECK (target_kind IN ('session', 'schedule', 'offer', 'prices'));
ALTER TABLE marketing.links ADD COLUMN target_id uuid;
ALTER TABLE marketing.links ADD COLUMN target_product_id uuid GENERATED ALWAYS AS (CASE WHEN target_kind = 'offer' THEN target_id END) STORED;
-- SL-8: only a member's own invite shows her first name, and only while she leaves this on.
ALTER TABLE marketing.links ADD COLUMN show_name boolean NOT NULL DEFAULT true;

-- backfill:begin links
UPDATE marketing.links SET target_kind = 'session', target_id = session_id WHERE session_id IS NOT NULL;
-- backfill:end links

ALTER TABLE marketing.links ADD CONSTRAINT links_target_id_check
    CHECK ((target_kind IN ('session', 'offer')) = (target_id IS NOT NULL));
ALTER TABLE marketing.links ADD CONSTRAINT links_target_session_check
    CHECK ((target_kind = 'session') = (session_id IS NOT NULL) AND (target_kind <> 'session' OR session_id = target_id));
ALTER TABLE marketing.links ADD CONSTRAINT links_target_product
    FOREIGN KEY (organization_id, target_product_id) REFERENCES scheduling.pass_products (organization_id, id);
-- The member switches her name on and off on her own link (SL-8); nothing else on a link changes.
GRANT UPDATE (show_name) ON marketing.links TO $app_role$;

-- Products a studio lists publicly (SL-4, SL-5): off by default, in the owner's order, an offer for newcomers only
-- with an optional last day and a short line.
ALTER TABLE scheduling.pass_products ADD COLUMN public_listed boolean NOT NULL DEFAULT false;
ALTER TABLE scheduling.pass_products ADD COLUMN public_order int CHECK (public_order BETWEEN 0 AND 999);
ALTER TABLE scheduling.pass_products ADD COLUMN newcomers_only boolean NOT NULL DEFAULT false;
ALTER TABLE scheduling.pass_products ADD COLUMN public_until date;
ALTER TABLE scheduling.pass_products ADD COLUMN public_blurb text CHECK (char_length(public_blurb) BETWEEN 1 AND 120);

-- The intro product of stage A becomes a listed offer for newcomers; `public_pages.intro_product_id` stays readable
-- for one release.
-- backfill:begin products
UPDATE scheduling.pass_products p
SET public_listed = true, newcomers_only = true, public_order = 0
FROM organizations.public_pages pp
WHERE pp.organization_id = p.organization_id AND pp.intro_product_id = p.id;
-- backfill:end products

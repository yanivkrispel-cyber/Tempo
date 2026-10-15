# Billing and Entitlements LLD (Phase 3)

> **Status:** Draft for Kris's review, 2026-10-15 (day board #60). Not normative until the open questions in
> section 14 are answered and this document merges.
> **Audience:** Engineering, AI coding agents
> **Inputs:** `10_Billing_Architecture.md`, `04_Multi_Tenant_Architecture.md` section 8, `16_Event_Driven_Architecture.md`,
> `24_Development_Roadmap.md` section 5, `27_Authorization_and_People_LLD.md`, ADR-0004 (webhooks get their own
> function), ADR-0008 (one work queue), ADR-0015, ADR-0021 (zero fixed cost until revenue), ADR-0023
> **Decision policy:** as in docs/26. **Proposed** marks a design choice this draft recommends; it becomes a
> **Decision** when the document merges. **Open** needs Kris's answer; each has a default.

## 1. Scope

Phase 3 is how Tempo charges a studio for using Tempo (platform billing, `10_Billing_Architecture.md`), and how the
product decides what a studio may use (entitlements). A studio charging its own clients is merchant payments
(`13_Payments.md`), a later phase.

In scope:

- plans as versioned sets of entitlements, and one subscription per studio;
- the subscription state machine, including trial, grace and **restricted mode**;
- an entitlement service that product code asks ("may this studio add a 4th staff member?"), never the plan name;
- a billing-provider adapter with a **manual provider** first, and the shape of the real provider integration:
  webhook function, durable inbox, idempotent normalization, reconciliation;
- the operator console's billing actions and the studio owner's billing page.

Out of scope, and where it goes:

| Item | Where |
|---|---|
| A studio charging its clients (class packs, memberships, receipts to clients) | Merchant payments, Phase 6 |
| Tax documents for Tempo's own invoices to studios | The provider or an invoicing service (B-2); Tempo stores references only |
| Usage-based pricing (per booking, per message) | When a plan needs it; the meter table is designed in, not built (section 5.4) |
| Coupons, referral credits | After the pilot |

## 2. Constraints that shape this design

- **No fixed cost before revenue (ADR-0021).** Israeli payment providers charge a monthly terminal fee on top of the
  per-transaction fee. Tempo signs with a provider only when the first studio pays. Until then billing runs on the
  manual provider: an operator records that a studio paid (bank transfer, or a payment link from the chosen
  provider's dashboard), and everything downstream (states, entitlements, restricted mode) works the same.
- **Stripe does not process for Israeli businesses** as far as a search on 2026-10-15 shows (Globes; Stripe Atlas
  with a US company is the known route). To re-check before B-1. The adapter
  must therefore fit Israeli providers, which differ from Stripe: tokens instead of hosted subscription objects in
  some, recurring billing owned by the provider in others, and tax documents from the provider or a separate service.
- **No card data in Tempo.** Hosted payment pages or provider fields only; Tempo stores provider references and the
  card's last four digits and expiry for display.
- **The pilot is free** (B-4 default). Phase 3 must be done before the first studio pays, not before the pilot starts.

## 3. Model

```text
Plan ──< PlanVersion ──< PlanEntitlement
                │
Organization ── BillingAccount ── Subscription ──< SubscriptionEvent
                                       │
                                  EntitlementSnapshot (current, versioned)
```

- **Plan:** a stable product key (`studio_basic`, `studio_pro`) and a Hebrew name.
- **PlanVersion:** an immutable set of prices and entitlements. Changing a price creates a new version; existing
  subscriptions stay on theirs until moved (grandfathering by default).
- **PlanEntitlement:** a key and a value, from a catalog in code like the permission catalog:
  - limits: `staff.max` (int), `clients.max` (int), `locations.max` (int);
  - features: `feature.whatsapp` (bool), `feature.white_label` (bool), `feature.reports.advanced` (bool).
- **BillingAccount:** one per studio: billing email, legal name and business id (ע.מ / ח.פ) for tax documents, the
  provider's customer reference.
- **Subscription:** one live per studio: plan version, state, period start and end, trial end, grace end, provider
  reference, `cancel_at_period_end`.
- **SubscriptionEvent:** append-only history of every state change and its cause (provider event id, operator, job).
- **EntitlementSnapshot:** the studio's effective entitlements, computed from the plan version plus operator
  overrides, with a version number. Product code reads only this.

## 4. Subscription states

**Proposed** (refines `10_Billing_Architecture.md` section 3 and `04` section 8):

| State | Enters when | Studio can | Leaves to |
|---|---|---|---|
| `trialing` | Studio created (B-3: 30 days) | Everything in the trial plan | `active` (paid), `restricted` (trial ended unpaid) |
| `active` | A payment succeeded | Everything in its plan | `past_due` (renewal failed), `canceled` (period ended after cancel) |
| `past_due` | A renewal payment failed | Everything; owner sees a banner | `active` (retry succeeded), `grace` (retries exhausted) |
| `grace` | Retries exhausted (B-5: 7 days) | Everything; owners and admins get daily reminders | `active`, `restricted` |
| `restricted` | Grace or trial ended unpaid | **Read and export only**; clients can view and cancel bookings, nobody creates anything new | `active` (paid), `canceled` (90 days) |
| `canceled` | Owner canceled and the period ended, or 90 days restricted | Owner can export and reactivate; others nothing | `active` (reactivated) |

- Restricted mode is a tenant-route rule, not a module rule: the tenant filter loads the subscription state with the
  membership and refuses writes with 402 `billing.restricted` except an allowlist (export, billing page, owner
  transfer, leaving the studio). Reads stay open so nobody loses their data.
- `organizations.status = suspended` (operator action, Phase 1) stays separate and wins over everything.
- Every transition is a `SubscriptionEvent` and an audit event; transitions run in the worker, driven by provider
  events, operator actions and a daily job for time-based steps (trial end, grace end).

## 5. Entitlements

### 5.1 Reading

- `IEntitlements.For(organizationId)` returns the current snapshot: `Limit("staff.max")`, `Has("feature.whatsapp")`.
  It is loaded with the membership in the tenant filter (one more column, the snapshot JSON), like permissions.
- `GET /me` gains `entitlements` per studio so the apps can hide or upsell features. The API stays the enforcement.

### 5.2 Enforcing limits

- A limit is checked where the thing is created, inside the same transaction, with a count: inviting the 4th staff
  member when `staff.max = 3` gives 403 `entitlement.limit_reached` with the key and the limit in the Problem.
- A downgrade never deletes data. Above a new limit, existing rows stay; only new ones are refused.

### 5.3 Overrides

- An operator may override one key for one studio (a pilot studio gets `staff.max = 10`), with a reason and an
  optional end date. Overrides are rows, audited, and part of the snapshot computation.

### 5.4 Usage meters (designed, not built)

- A `billing.usage_counters` table (studio, meter key, period, count) for future usage-based items, incremented by
  domain events. Not created in Phase 3 unless a pilot plan needs it.

## 6. Providers

### 6.1 The adapter

**Proposed.** One interface in `Modules/Billing/Providers`, implemented per provider:

```text
CreateCheckout(subscription, planVersion) → hosted page URL      (first payment, card on file)
ChargeRenewal(subscription) → result                              (only for token-based providers)
Cancel(subscription)
ParseWebhook(headers, body) → verified, normalized BillingEvent   (signature check inside)
FetchState(providerReference) → normalized state                 (reconciliation)
```

- **Manual provider** (Phase 3 default): no network. Operator actions produce the same normalized `BillingEvent`s
  (`payment.succeeded` with an amount and a note, `subscription.canceled`).
- **Real provider** (B-1): token-based Israeli providers (Cardcom, Tranzila, Grow token billing) need Tempo to run the
  renewal schedule (`ChargeRenewal` from the daily job); provider-managed recurring (Grow recurring, Cardcom recurring
  orders) need only webhooks. The adapter supports both; the provider's mode is a property of the implementation.

### 6.2 Webhooks

- A separate Lambda function and route (`POST /webhooks/billing/{provider}`), outside CloudFront's origin access
  control, as ADR-0004 already says for providers. It verifies the signature (or the provider's callback secret plus
  a server-to-server status query when the provider has no signatures), writes the raw event to
  `billing.webhook_inbox` (unique on provider event id), puts a `billing.webhook` message on the work queue and
  answers 200. Nothing else happens in the request.
- The worker normalizes inbox rows idempotently and applies them to the subscription. A redirect back from the hosted
  page is never treated as payment (`13_Payments.md` section 5).

### 6.3 Reconciliation

- A daily job (the same EventBridge Scheduler pattern as the 10-studio tripwire) compares every non-manual
  subscription with `FetchState` and writes mismatches to a table and an alarm; it auto-corrects only the safe cases
  (provider says paid, Tempo says past_due).

### 6.4 Tax documents

- Tempo's invoices to studios are tax documents under Israeli law. **Open B-2:** issued by the payment provider
  (Cardcom and some others generate חשבונית מס / קבלה in the payment flow), or by an invoicing service (Morning /
  Green Invoice, iCount) called after `payment.succeeded`. Tempo stores the document number and URL only.

## 7. Database

Migration `0009_billing.sql` (0008 is the invitation person link, #80 brings 0007). Schema `billing`, owned by the
migrator, RLS as in docs/26 section 7 for the tenant tables.

```sql
CREATE SCHEMA billing;

CREATE TABLE billing.plans (id uuid PRIMARY KEY, key text UNIQUE NOT NULL, display_name text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE billing.plan_versions (
    id uuid PRIMARY KEY, plan_id uuid NOT NULL REFERENCES billing.plans (id), version int NOT NULL,
    price_minor bigint NOT NULL, currency char(3) NOT NULL DEFAULT 'ILS', interval text NOT NULL CHECK (interval IN ('month', 'year')),
    is_public boolean NOT NULL, created_at timestamptz NOT NULL, UNIQUE (plan_id, version));
CREATE TABLE billing.plan_entitlements (
    plan_version_id uuid NOT NULL REFERENCES billing.plan_versions (id), key text NOT NULL, value jsonb NOT NULL,
    PRIMARY KEY (plan_version_id, key));

CREATE TABLE billing.billing_accounts (            -- one per studio
    organization_id uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    billing_email text, legal_name text, business_id text, provider text NOT NULL DEFAULT 'manual',
    provider_customer_ref text, card_last4 text, card_expiry text, created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0);
CREATE TABLE billing.subscriptions (
    organization_id uuid NOT NULL, id uuid NOT NULL, plan_version_id uuid NOT NULL REFERENCES billing.plan_versions (id),
    state text NOT NULL CHECK (state IN ('trialing', 'active', 'past_due', 'grace', 'restricted', 'canceled')),
    trial_ends_at timestamptz, current_period_start timestamptz, current_period_end timestamptz, grace_ends_at timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false, provider_subscription_ref text,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id));
CREATE UNIQUE INDEX ux_subscriptions_one_live ON billing.subscriptions (organization_id) WHERE state <> 'canceled';
CREATE TABLE billing.subscription_events (          -- append-only
    organization_id uuid NOT NULL, id uuid NOT NULL, subscription_id uuid NOT NULL, from_state text, to_state text NOT NULL,
    cause text NOT NULL, provider_event_id text, actor_type text NOT NULL, actor_id uuid, occurred_at timestamptz NOT NULL,
    data jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (organization_id, id));
CREATE TABLE billing.entitlement_overrides (
    organization_id uuid NOT NULL, key text NOT NULL, value jsonb NOT NULL, reason text NOT NULL,
    ends_at timestamptz, created_by_operator uuid NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (organization_id, key));
CREATE TABLE billing.entitlement_snapshots (
    organization_id uuid PRIMARY KEY, version bigint NOT NULL, entitlements jsonb NOT NULL, computed_at timestamptz NOT NULL);
CREATE TABLE billing.webhook_inbox (
    id uuid PRIMARY KEY, provider text NOT NULL, provider_event_id text NOT NULL, received_at timestamptz NOT NULL,
    payload jsonb NOT NULL, processed_at timestamptz, error text, UNIQUE (provider, provider_event_id));
```

Grants: `tempo_app` reads its tenant's billing account, subscription and snapshot (owner and admin routes only);
writes go through the worker and `tempo_platform`. Plans are readable by everyone. The inbox is worker-only.

Data migration: every existing studio gets a billing account (manual provider) and a `trialing` subscription on the
pilot plan (B-4), with `trial_ends_at` per B-3.

## 8. API

Tenant routes (customer token):

| Method and path | Permission |
|---|---|
| `GET /organizations/{id}/billing` (plan, state, period, card last four, next charge) | `billing.view` (new: owner, admin) |
| `POST /organizations/{id}/billing/checkout` (hosted page URL; real provider only) | `billing.manage` (new: owner), step-up |
| `PATCH /organizations/{id}/billing/account` (billing email, legal name, business id) | `billing.manage` |
| `POST /organizations/{id}/billing/cancel`, `POST .../reactivate` | `billing.manage`, step-up |
| `GET /plans` (public plan versions) | any signed-in account |

`GET /me` memberships gain `subscriptionState` and `entitlements`.

Platform routes (operator token): list studios with subscription state; `POST .../billing/payments` (manual
provider: record a payment with amount, method and note); `PUT .../billing/plan` (move a studio to a plan version);
`PUT .../billing/overrides/{key}`; `POST .../billing/trial-extension`. All audited with reason.

Webhook route: `POST /webhooks/billing/{provider}` (no token; provider signature), section 6.2.

New Problem codes: `billing.restricted` (402), `entitlement.limit_reached` (403), `billing.provider_unavailable`
(503), `billing.no_payment_method` (409).

## 9. Infrastructure

- Manual provider: **none.** No new AWS resource, $0.
- Real provider (when B-1 is decided and the first studio pays): one Lambda function and one API route for webhooks
  (free tier), one SSM SecureString per provider secret ($0, ADR-0021 prefers it over Secrets Manager in dev), one
  Scheduler schedule for the daily billing job (same as the tripwire). The provider's own monthly fee is the only
  recurring cost and needs Kris's approval when it starts.

## 10. Apps

- Admin app: billing page (plan, state, next charge, card on file, billing details, cancel/reactivate); banners for
  `past_due`, `grace`, `restricted`; disabled create buttons with an upsell where an entitlement is off.
- Client app: restricted studios show a calm "the studio's account is paused" notice; bookings can be viewed and
  canceled.
- Operator console: billing column, record payment, change plan, overrides, trial extension.

## 11. Tests

- Unit: the state machine (every allowed and refused transition, time-based steps with a fake clock); entitlement
  snapshot computation (plan + overrides + expiry); restricted-mode allowlist through the tenant filter; webhook
  signature verification per provider with recorded fixtures.
- Integration (PostgreSQL 18): one live subscription per studio; snapshot recomputed on plan change and override;
  limit enforcement under concurrency (two invitations racing for the last seat); inbox idempotency (the same
  provider event twice changes state once); RLS on billing tables.
- API: restricted studio refuses writes with 402 and allows the allowlist; `GET /me` carries state and entitlements.

## 12. Delivery plan

One PR each, in order:

1. This LLD (merged after Kris answers section 14).
2. OpenAPI contract for section 8.
3. Migration 0009 with the data migration (every studio trialing on the pilot plan) and integration tests.
4. Entitlement catalog, snapshot service, `GET /me` additions, limit checks at the three creation points (invite
   staff, join as client, locations later).
5. Subscription state machine, the daily billing job, restricted mode in the tenant filter.
6. Manual provider and the operator billing actions.
7. Billing page routes for owners.
8. Provider adapter for the chosen provider (B-1): checkout, webhook function and inbox, normalization,
   reconciliation. Only when a studio is about to pay.

## 13. Risks

- **Restricted mode locks people out of something important.** The allowlist is explicit and tested; reads never
  close; a studio admin can always export (section 4).
- **Provider without signed webhooks.** Some Israeli providers send a callback without a signature; the handler then
  confirms every event with a server-to-server status query before applying it.
- **Tax compliance.** Israeli invoicing rules (for example allocation numbers, מספר הקצאה, phased in from 2024 for
  invoices above a threshold; to confirm with the accountant) are the invoicing service's job; Tempo must not generate
  its own tax documents.
- **Price changes.** Plan versions are immutable; moving existing studios to a new price is an explicit operator
  action with notice to the owner (B-6).

## 14. Open questions for Kris

| Id | Question | Default if nobody objects |
|---|---|---|
| B-1 | Which payment provider, and when? Candidates: Cardcom (payments plus tax documents in one), Grow / Meshulam (token or managed recurring), Tranzila (token billing), PayPlus. | Decide when the first studio is ready to pay; until then the manual provider. Shortlist Cardcom and Grow, and compare monthly fee, per-transaction fee, signed webhooks and document generation. |
| B-2 | Tax documents for Tempo's invoices: from the provider, or from an invoicing service (Morning, iCount)? | From the provider if it is Cardcom; otherwise Morning. Ask the accountant (same meeting as P-2). |
| B-3 | Trial length for a new studio | 30 days |
| B-4 | Pilot studios: free, and on which plan? | Free for the pilot on a `pilot` plan with generous limits, moved to a paid plan with 30 days' notice |
| B-5 | Retries and grace after a failed renewal | 3 retries over 7 days (`past_due`), then 7 days `grace`, then `restricted` |
| B-6 | Plans and prices at launch, and the limits in each | Kris decides; the model supports any set. A starter set to react to: Basic (1 location, 3 staff, 150 clients) and Pro (3 locations, 15 staff, unlimited clients, WhatsApp add-on) |
| B-7 | Monthly or yearly billing, and VAT shown with or without | Monthly and yearly (two months free); prices shown including VAT (B2B in Israel, but small studios think in gross) |
| B-8 | What restricted mode allows clients to do | View and cancel their bookings; no new bookings |

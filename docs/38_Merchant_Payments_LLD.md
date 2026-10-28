# Merchant Payments LLD (a member pays the studio in the app)

> **Status:** Draft for review, board #537 K3, 2026-10-28. Docs only (decision V-4 on #537): no provider is chosen,
> no account is opened, no SDK or package is added, nothing is built. M-1 to M-15 (section 14) carry defaults that
> apply unless Kris changes them; Kris can answer "keep the defaults" in one word.
> **Audience:** Kris, Ofir, the agents.
> **Related:** docs/13 (the merchant payments baseline), docs/10 and docs/28 (Tempo billing studios: a separate
> thing, section 1), docs/29 (pass products, passes, bookings, the ledger), docs/37 (the public page, offers and
> events "to pay at the studio"), docs/27 (permissions), docs/32 (reports), docs/20 (security), ADR-0004 (webhooks
> get their own function), ADR-0008 (one work queue), ADR-0021 ($0 until revenue), ADR-0026 (field encryption
> without a CMK), D14 (public repo), D15 (phone and computer), epic #293, #278 (Tempo's own payment provider), #306
> (legal wording).
> **Ids:** M-1 to M-15 here are this document's. docs/37 has its own M-1 to M-17; they are cited as "docs/37 M-8".

Today a member never pays in Tempo. A studio sells a pass at the desk and staff grant it (`POST
/people/{personId}/passes`, note "שולם במזומן"). A newcomer who joins from the public page gets an offer "to pay at
the studio" (`scheduling.passes.to_pay_at_studio`, migration 0034), and an event booked without a pass is marked the
same way on the booking (`scheduling.bookings.to_pay_at_studio`, migration 0035), which the roster shows as the chip
"לתשלום בסטודיו". The member app's profile has a row "קבלות ותשלומים" that only says "האפשרות הזו תגיע בקרוב"
(`apps/client-web/src/features/member/ProfileScreen.tsx`). The public pages say "נרשמים כאן, משלמים בסטודיו".

This document plans how a member pays the studio in the app for a pass, a drop-in or an event, how refunds,
receipts and Israeli tax documents work, the shape of a provider adapter, and what changes in passes and the roster.
Paying at the studio stays exactly as it is for anyone who does not pay in the app.

## 1. Scope and non-goals

In:

- the money flow: the studio is the merchant, the provider hosts the payment page (section 2);
- three things a member can buy: a pass product, a drop-in for one class, an event place (section 3);
- orders, payments, holds on a place while paying, failure and abandonment, race conditions (section 3);
- refunds, cancellations and chargebacks (section 4);
- receipts and Israeli tax documents, and who issues them (section 5);
- the provider adapter, the webhook intake, secrets per studio, and how to choose a provider (section 6);
- what changes in passes, the roster, the console and reports (sections 7 and 8);
- security, privacy and retention (section 9); stages, tests and telemetry (sections 10 to 12).

Out, and where it goes:

| Item | Where |
|---|---|
| Tempo charging a studio for Tempo (plans, subscriptions, restricted mode) | docs/28, epic #278. Different tables (`billing.*`), different money, different provider account. Nothing here touches it. |
| Choosing a provider, opening any account, adding an SDK | A decision for Kris when a studio is ready to take payments (M-15). Section 6.5 lists the criteria only. |
| Production | docs/runbooks/production-readiness.md (board #537 K4). |
| Recurring memberships (a monthly charge until cancelled) | Later (M-14). Stage 1 sells a membership pass for its `valid_days`, paid once. |
| Gift cards, coupons, a shop for goods, tips | Not planned. |
| Studios outside Israel, a currency other than ILS | Not planned (M-12). |

## 2. Money flow

### 2.1 The studio is the merchant of record

```text
member's card ──> provider's hosted page ──> the STUDIO's merchant account ──> the studio's bank
                         │
                         └── signed webhook ──> Tempo: mark the order paid, grant the pass or the place
```

- **The studio sells; the member buys from the studio.** The studio has its own merchant account (a terminal, or
  a sub-merchant under a provider's platform account) and the money settles to its bank. The tax document carries the
  studio's name and business number (section 5).
- **Tempo never holds, collects or forwards the money** (M-1). Why:
  - **Licensing.** Holding or transferring other people's money for payment is a regulated activity in Israel (a
    payment-services licence from the Israel Securities Authority or an exemption; *to verify with a lawyer* before
    anything else is considered). A software vendor that only passes instructions to a licensed provider needs none.
  - **Liability.** As the merchant, the studio owns refunds, chargebacks and consumer-law duties to its members.
    Tempo would otherwise carry every studio's chargebacks and refund disputes on its own balance.
  - **Tax.** If money passed through Tempo, Tempo's turnover would include every class sold, with VAT and documents
    for each. It must not.
  - **Cost.** ADR-0021: the merchant account and its fees are the studio's, so Tempo's fixed cost stays $0.

### 2.2 No card data touches Tempo (PCI DSS SAQ A)

- The member pays on the **provider's hosted payment page**, reached by a full-page redirect (M-13). Tempo's apps
  and API never see a card number, CVV or full expiry; Tempo stores the provider's references, the card brand and the
  last four digits for display.
- With a full redirect the studio, as the merchant, stays in the smallest PCI DSS scope, the self-assessment **SAQ
  A**. Since the January 2025 revision of SAQ A (PCI DSS v4.0.1), a merchant that embeds the provider's fields in an
  iframe must also confirm its page is not susceptible to script attacks; a full redirect avoids that question.
  Sources: [Compass IT](https://www.compassitc.com/blog/saq-a-requirements-6.4.3-11.6.1-what-the-eligibility-change-means),
  [cside](https://cside.com/blog/demystifying-the-january-2025-updates-to-pci-dss-saq-a) (vendor blogs; *to verify*
  against the PCI SSC's own SAQ A text before the first studio goes live).
- Hosted fields in an iframe stay possible later, only with the provider's written statement that covers script
  protection.

### 2.3 Platform fees (later, M-2)

Tempo takes **no cut of the member's payment** (M-2). If Tempo ever charges per sale, it bills the studio through its
own subscription (docs/28 section 5.4, the designed `billing.usage_counters` meter), not by splitting the member's
payment. A split payment ("marketplace" mode, where the provider pays Tempo a share) is a provider feature to look
at only if Kris asks for it; it would make Tempo a party to every sale and needs a lawyer first.

## 3. What a member can pay for

### 3.1 Three kinds of purchase

| Kind | Today | With payments | What a paid order produces |
|---|---|---|---|
| **Pass** | A product (`scheduling.pass_products`, `punch_card` or `membership`, `price_agorot` shown only) granted at the desk | "לרכישה" on a product the studio offers in the app | A pass (`scheduling.passes`) with `source = 'app'` and the order's id |
| **Drop-in** | Not a concept in the code. A studio makes a one-entry card and grants it | Buying one class while booking it (M-3) | A one-entry pass for that class plus the booking, in one transaction |
| **Event** | A one-off session with `event_price_agorot` and `pass_required = false`; the booking is `to_pay_at_studio` (docs/37 section 8.4) | Paying the event price while booking | The booking, `to_pay_at_studio = false`, with the order's id |

- **Drop-in model (M-3, new).** The studio marks one `punch_card` product with one entry as its drop-in price (new
  column `pass_products.drop_in boolean`, at most one active per studio and class category). Buying a drop-in for a
  session creates a pass of that product, valid from the session's date for `valid_days`, and books the session with
  it. If the member later cancels inside the free window, the entry returns to that pass like any card (M-9). This
  reuses the ledger of docs/29 section 5.4 and needs no new booking path.
- **Which products are sellable in the app** (new column `pass_products.sold_in_app boolean`, default false). The
  public product listing of docs/37 section 12.2 (`public_listed`, `newcomers_only`) stays as it is; a product can be
  listed and sold, listed and "to pay at the studio", or neither.
- **Prices.** `pass_products.price_agorot` and `sessions.event_price_agorot` are the gross price a member pays, VAT
  included where the studio charges VAT (M-12). The order copies the amount at checkout; a later price change never
  alters an open order.

### 3.2 Database (new schema `commerce`, one migration numbered at build time)

All tables follow docs/26 section 7 and docs/29 section 7: UUID v7, tenant-leading keys, composite foreign keys,
`timestamptz`, `version` on mutable rows, RLS with the tenant clause on every table. Amounts in agorot (`bigint`).
Every name below is **new**.

```sql
CREATE SCHEMA commerce;

-- One per studio: which provider, whether it is live, and what kind of business the studio is.
CREATE TABLE commerce.merchant_accounts (
    organization_id    uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    provider           text NOT NULL,                      -- 'fake' in tests and on dev; a provider key later
    mode               text NOT NULL CHECK (mode IN ('sandbox', 'live')),
    status             text NOT NULL CHECK (status IN ('pending', 'active', 'paused', 'closed')),
    provider_merchant_ref text,                            -- the provider's id for the studio's terminal; not a secret
    business_type      text NOT NULL CHECK (business_type IN ('exempt_dealer', 'licensed_dealer', 'company')),
    legal_name         text NOT NULL CHECK (length(legal_name) BETWEEN 2 AND 120),
    business_id        text NOT NULL CHECK (business_id ~ '^[0-9]{9}$'),
    documents_by       text NOT NULL CHECK (documents_by IN ('provider', 'invoicing_service')),
    invoicing_service  text,                               -- set when documents_by = 'invoicing_service'
    secrets_version    int NOT NULL DEFAULT 0,             -- bumped when a person rotates the SSM secrets (6.4)
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0
);

CREATE TABLE commerce.orders (
    organization_id    uuid NOT NULL,
    id                 uuid NOT NULL,
    person_id          uuid NOT NULL,                      -- the buyer's person record in this studio
    kind               text NOT NULL CHECK (kind IN ('pass', 'drop_in', 'event')),
    product_id         uuid,                               -- pass and drop_in
    session_id         uuid,                               -- drop_in and event
    description        text NOT NULL,                      -- the product or event name at checkout, for the document
    amount_agorot      bigint NOT NULL CHECK (amount_agorot > 0),
    vat_agorot         bigint NOT NULL DEFAULT 0,          -- 0 for an exempt dealer
    currency           char(3) NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
    status             text NOT NULL CHECK (status IN ('awaiting_payment', 'paid', 'fulfilled', 'failed',
                           'expired', 'cancelled', 'partially_refunded', 'refunded', 'disputed')),
    idempotency_key    uuid NOT NULL,                      -- from the app, one per tap on "לתשלום"
    hold_booking_id    uuid,                               -- the place held while paying (3.4)
    hold_expires_at    timestamptz,
    provider_checkout_ref text,
    pass_id            uuid,                               -- set on fulfilment
    booking_id         uuid,                               -- set on fulfilment
    refunded_agorot    bigint NOT NULL DEFAULT 0 CHECK (refunded_agorot BETWEEN 0 AND amount_agorot),
    source_link_id     uuid,                               -- last touch, like bookings (docs/37 M-12)
    paid_at timestamptz, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, person_id, idempotency_key),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, product_id) REFERENCES scheduling.pass_products (organization_id, id),
    FOREIGN KEY (organization_id, session_id) REFERENCES scheduling.sessions (organization_id, id),
    CHECK ((kind = 'pass' AND product_id IS NOT NULL AND session_id IS NULL)
        OR (kind = 'drop_in' AND product_id IS NOT NULL AND session_id IS NOT NULL)
        OR (kind = 'event' AND product_id IS NULL AND session_id IS NOT NULL))
);

-- Each attempt at the provider (a member may fail once and retry on the same order).
CREATE TABLE commerce.payments (
    organization_id    uuid NOT NULL, id uuid NOT NULL, order_id uuid NOT NULL,
    provider_payment_ref text NOT NULL,
    status             text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    amount_agorot      bigint NOT NULL,
    method             text CHECK (method IN ('card', 'apple_pay', 'google_pay', 'bit')),
    card_brand text, card_last4 text CHECK (card_last4 ~ '^[0-9]{4}$'), installments int NOT NULL DEFAULT 1,
    failure_code       text,                               -- the provider's code, never its free text
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, provider_payment_ref),
    FOREIGN KEY (organization_id, order_id) REFERENCES commerce.orders (organization_id, id)
);

CREATE TABLE commerce.refunds (
    organization_id    uuid NOT NULL, id uuid NOT NULL, order_id uuid NOT NULL,
    amount_agorot      bigint NOT NULL CHECK (amount_agorot > 0),
    reason             text NOT NULL CHECK (reason IN ('staff', 'session_cancelled', 'hold_lost', 'dispute_lost')),
    status             text NOT NULL CHECK (status IN ('requested', 'succeeded', 'failed')),
    idempotency_key    uuid NOT NULL,
    provider_refund_ref text,
    requested_by       uuid,                               -- membership; null for the system
    note               text CHECK (length(note) <= 200),   -- erased with the person, like passes.note
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, idempotency_key),
    FOREIGN KEY (organization_id, order_id) REFERENCES commerce.orders (organization_id, id)
);

-- References to tax documents someone else issued (section 5). Tempo never numbers a document.
CREATE TABLE commerce.documents (
    organization_id    uuid NOT NULL, id uuid NOT NULL, order_id uuid NOT NULL, refund_id uuid,
    kind               text NOT NULL CHECK (kind IN ('receipt', 'tax_invoice_receipt', 'tax_invoice', 'credit_invoice', 'refund_receipt')),
    issuer             text NOT NULL,                      -- the provider or the invoicing service
    number             text NOT NULL,
    allocation_number  text,                               -- מספר הקצאה, when the issuer obtained one (5.3)
    url                text,                               -- the issuer's link to the PDF
    issued_at          timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, issuer, number),
    FOREIGN KEY (organization_id, order_id) REFERENCES commerce.orders (organization_id, id)
);

-- Append-only: every money fact, for reconciliation and audit (docs/13 section 5).
CREATE TABLE commerce.financial_events (
    organization_id uuid NOT NULL, id uuid NOT NULL, order_id uuid NOT NULL,
    type text NOT NULL,          -- order.created, payment.succeeded, payment.failed, order.fulfilled, refund.succeeded, dispute.opened ...
    amount_agorot bigint, provider_event_id text, actor_type text NOT NULL, actor_id uuid,
    occurred_at timestamptz NOT NULL, data jsonb NOT NULL DEFAULT '{}',   -- ids, states and amounts only
    PRIMARY KEY (organization_id, id)
);

-- Raw provider events, worker-only, like docs/28's designed billing.webhook_inbox (not created by 0009).
CREATE TABLE commerce.webhook_inbox (
    id uuid PRIMARY KEY, organization_id uuid NOT NULL, provider text NOT NULL, provider_event_id text NOT NULL,
    received_at timestamptz NOT NULL, payload jsonb NOT NULL, processed_at timestamptz, error text,
    UNIQUE (provider, provider_event_id)
);
```

Changes to existing tables (all new columns):

| Table | Column | Why |
|---|---|---|
| `scheduling.pass_products` | `sold_in_app boolean NOT NULL DEFAULT false`, `drop_in boolean NOT NULL DEFAULT false` | 3.1 |
| `scheduling.passes` | `source text NOT NULL DEFAULT 'desk' CHECK (source IN ('desk', 'app', 'public_join', 'referral'))`, `order_id uuid` | Section 7.1. Backfill: `public_join` where `to_pay_at_studio`, `referral` from `marketing.referral_rewards.pass_id`, else `desk`. |
| `scheduling.bookings` | `order_id uuid`; status `pending_payment` added to the check and to `ux_bookings_one_live` | 3.4 |

Grants: `tempo_app` reads its tenant's orders, payments, refunds and documents and writes orders and refunds through
the services; the inbox and `financial_events` inserts are the worker's. `merchant_accounts` is read by the app and
written only by the owner's settings route.

### 3.3 Order states

```text
awaiting_payment ──payment.succeeded──> paid ──grant in one transaction──> fulfilled
       │                                   └── place lost while paying ──> refunded (M-5)
       ├── payment.failed (member may retry on the same order)
       ├── hold expired, no payment ──> expired
       └── member taps "ביטול" ──> cancelled
fulfilled ──> partially_refunded ──> refunded
fulfilled ──dispute.opened──> disputed ──won──> fulfilled  /  ──lost──> refunded
```

- `paid` is an internal step that lasts one transaction in the normal case; it is visible only when fulfilment
  failed and the worker retries it.
- **A redirect back from the hosted page is never proof of payment** (docs/13 section 5). Only a verified webhook,
  or the adapter's `FetchStatus` from the server, moves an order to `paid`.
- Fulfilment is idempotent: the order row is locked (`FOR UPDATE`), and a fulfilled order is never fulfilled again.

### 3.4 Holding a place while paying (M-4)

A pass purchase takes no place. A drop-in or an event does, and the class may fill while the member is on the
payment page.

1. `POST /me/orders` for a drop-in or an event runs the booking checks of docs/29 section 6.2 (not cancelled, not
   started, inside the horizon, no live booking, the health gate) and takes the place with the same atomic
   `UPDATE scheduling.sessions SET booked_count = booked_count + 1 ... WHERE booked_count < capacity`.
2. The booking is inserted with the new status `pending_payment` and `order_id`; no pass use is held yet. The order
   gets `hold_expires_at = now() + 10 minutes` (M-4). The roster shows the place as "ממתין לתשלום".
3. Full: no order is created. With an open waitlist the member joins it as today (no payment while waiting); she pays
   when promoted only if the studio sells drop-ins, as a new checkout. Full otherwise: `409 session.full`.
4. The hold ends when the payment succeeds (the booking becomes `booked`, the pass and the pass use are written in
   the same transaction), when the member cancels, or at `hold_expires_at`. Expiry is applied lazily by every read
   and booking path (like expired waitlists, docs/29 section 11) and by a sweep in the new `commerce.sweep` worker
   message every 5 minutes while holds exist. Releasing a hold runs the promotion of docs/29 section 6.3.
5. **Payment after the hold expired (M-5).** If a place is still free, the worker books it and fulfils the order.
   If not, it refunds the full amount automatically (`reason = 'hold_lost'`) and sends an inbox item
   "התשלום הוחזר: השיעור התמלא בזמן התשלום". The provider's page is configured to time out before the hold
   (`hold - 1 minute`) where the provider allows it, so this is rare.

Races covered by tests (section 11): two members paying for the last place (one hold wins at step 1, the other gets
`session.full` before paying); a double tap (the idempotency key returns the same order and hosted page URL); the
webhook arriving twice or before the redirect (the inbox unique key and the order lock); the studio cancelling the
class during a hold (the hold is released, the order cancelled, and a payment that still arrives is refunded with
`reason = 'session_cancelled'`).

### 3.5 Failed and abandoned payments

- `payment.failed`: the order stays `awaiting_payment` while the hold lasts; the member sees "התשלום לא עבר" and
  can try again (a new `commerce.payments` row on the same order). The provider's failure code maps to three Hebrew
  messages (declined, try another card, technical); the code is stored, its free text is not.
- Abandoned: the order becomes `expired` with its hold. A pass order with no hold expires after 24 hours.
- A pending order older than 15 minutes with no webhook is checked once with `FetchStatus` by the sweep (a lost
  webhook), and daily by reconciliation (6.3).

## 4. Refunds, cancellations and chargebacks

### 4.1 Who may refund (docs/27 terms)

New permission keys (catalog in `backend/Tempo.Platform/BuildingBlocks/Tenancy/Permissions.cs`, seeded into the
system roles by the migration):

| Key | What it allows | owner | admin | staff | client |
|---|---|---|---|---|---|
| `payments.view` | See orders, payments, refunds and documents of everyone in the studio | yes | yes | | |
| `payments.refund` | Refund an order, fully or in part | yes | yes (M-7) | | |
| `payments.settings.manage` | Connect, pause or close the studio's merchant account; business details | yes | | | |

Resource rule **self**: a member reads her own orders and documents (`GET /me/orders`). Staff at the desk keep
seeing "שולם באפליקציה" on the roster and the person card with `passes.view`, without amounts or card details.
A refund needs a recent sign-in (step-up, as `billing.manage` in docs/28) and is audited.

### 4.2 Refunding

- `POST /orders/{orderId}/refunds` with `{ amountAgorot, note?, voidPass?, idempotencyKey }`. The sum of refunds
  never exceeds the amount paid (`refunded_agorot` check and a row lock).
- **Full refund of a pass:** voids the pass (`POST /passes/{id}/void` semantics, docs/29 section 5.2) unless staff
  untick "לבטל את הכרטיסייה". Bookings already taken keep their entries; future bookings on the voided pass are
  cancelled by staff with the entry returned, as for an erased person.
- **Partial refund (M-8):** allowed. The console suggests a pro-rata amount for a card (price / entries x unused
  entries) and the unused days for a membership; staff may change it. The pass is kept unless staff choose to void
  it. No automatic change to the remaining entries.
- **Refund of an event or a drop-in** cancels the booking if the class has not started (`cancel_reason = 'staff'`,
  the place freed, promotion runs).
- The refund goes to the provider through the adapter (`Refund`), whose result arrives as a webhook or a status
  answer; the refund is `succeeded` only then. The issuer then makes the credit document (5.2).
- A refund window: none in Tempo. The provider's own limit applies (often months; *to verify per provider*).

### 4.3 Cancellations and the free-cancellation window

| Case | What happens to the money | What happens to the entry |
|---|---|---|
| Member cancels a paid drop-in inside `free_cancel_hours` | Nothing automatic (M-9) | Returns to the one-entry pass, usable for another class while the pass is valid |
| Member cancels late, or does not come | Nothing | Used (docs/29 section 5.4) |
| Member cancels a paid event place | Nothing automatic; the studio may refund (M-9) | No entry; the place is freed |
| The studio cancels a class (docs/29 C-8) | Drop-in: nothing automatic, the entry returns. Event: **automatic full refund** (M-10) | Returns |
| Member cancels a pass she bought online, inside the legal window | The studio refunds through 4.2 (M-7) | The pass is voided |

**Consumer law.** Israel's Consumer Protection Law section 14ג lets a buyer in a distance sale cancel within 14 days,
with a cancellation fee capped at 5% of the price or 100 ILS, whichever is lower; an amendment about continuing
services that already started was in the Knesset
([Bizportal](https://www.bizportal.co.il/financialconsumerism/news/article/20036709),
[Bizportal](https://www.bizportal.co.il/general/news/article/218430)). How it applies to a punch card or a membership
bought in an app is **to verify with the lawyer** in the same review as #306. Tempo's part: the refund flow
supports it, and the checkout shows the studio's cancellation terms and a link to them before payment.

### 4.4 Chargebacks (M-11)

- The provider's `dispute.opened` event marks the order `disputed`, writes a financial event, and notifies the owner
  (inbox, and push when the owner allows it). The pass is **not** voided automatically; the owner decides.
- Evidence is submitted in the provider's dashboard, not in Tempo. Tempo offers a one-page export of the order: the
  purchase time, the bookings and attendance on the pass, and the documents.
- `dispute.won` returns the order to `fulfilled`; `dispute.lost` records a refund with `reason = 'dispute_lost'`.

## 5. Receipts and Israeli tax documents

### 5.1 What each kind of studio issues

| Studio | Registered as | Issues on a member's payment | VAT |
|---|---|---|---|
| A sole trader under the exempt turnover limit | עוסק פטור | קבלה (receipt) | None |
| A sole trader or partnership | עוסק מורשה | חשבונית מס-קבלה (tax invoice and receipt in one), since payment and supply are together | 18% included in the price |
| A company | חברה בע"מ | חשבונית מס-קבלה, as above | 18% included |

- **VAT rate:** 18% since 2025-01-01 (2025 Budget Law; a proposed rise to 19% in 2026 was dropped). Sources:
  [PwC tax summaries](https://taxsummaries.pwc.com/israel/individual),
  [vatcalc](https://www.vatcalc.com/vat/israel-vat-rise-to-19-jan-2026-proposal/). Re-check the rate at build time; the
  rate is never hard-coded in an order (the order stores `vat_agorot` as the issuer computed it).
- A refund produces חשבונית זיכוי (credit invoice) for a licensed dealer or a company, and a refund receipt or a
  negative receipt for an exempt dealer (*to verify the exempt dealer's document with the accountant*).
- A member who asks for a document in a company's name (a business buying a pass for an employee) is out of stage 1;
  documents are in the member's name as it is in the studio (`people.people.display_name`).

### 5.2 Who issues the document (M-6)

Tempo **never issues or numbers a tax document**. In Israel, software that produces tax documents must meet the Tax
Authority's bookkeeping rules for computerized systems (registration of the software; *to verify*), and every studio
already has an accountant and often an invoicing account. Two ways, chosen per studio in `documents_by`:

| Way | How | Good | Not so good |
|---|---|---|---|
| `provider` | The payment provider issues the document as part of the charge and sends it to the member | One account, one webhook; the document number arrives with the payment | Only some providers do it; the studio may already invoice elsewhere |
| `invoicing_service` | After `payment.succeeded`, the worker calls the studio's own invoicing service with the order; the service emails the document | Fits studios that already use one; any provider | A second integration and a second secret per studio |

Tempo stores the document's kind, number, allocation number (if any) and link in `commerce.documents`, and shows it
in "קבלות ותשלומים". If the issuer fails, the order stays fulfilled (the member paid and has her pass), the document
call is retried by the worker, and the owner sees "מסמך לא הופק" on the payments page after 3 failed attempts.

### 5.3 The allocation number (מספר הקצאה)

Under the "חשבוניות ישראל" reform, a licensed dealer must obtain an allocation number from the Israel Tax Authority
for a tax invoice above a threshold, or the buyer cannot deduct the input VAT. The thresholds, before VAT:

| From | Invoices above |
|---|---|
| 2024-05 | 25,000 ILS |
| 2025-01-01 | 20,000 ILS |
| 2026-01-01 | 10,000 ILS |
| 2026-06-01 | 5,000 ILS |

Sources: [Green Invoice (Morning) magazine](https://www.greeninvoice.co.il/magazine/israel-invoice/),
[VATit](https://vatit.com/es/e-invoicing-guide/israel/),
[Bizportal](https://www.bizportal.co.il/general/news/article/20032314). The threshold excludes VAT; an exempt dealer
issues receipts and is not affected; the number is given to חשבונית מס and חשבונית מס-קבלה only. **To verify:** an
official Tax Authority (gov.il) page for the 2026 dates, and whether a document to a private consumer (who deducts no
VAT) needs a number at all. What it means here:

- Most member purchases are far below 5,000 ILS. A yearly membership could pass it.
- Obtaining the number is the **issuer's** job (the provider or the invoicing service talks to the Tax Authority).
  A provider or service that cannot obtain allocation numbers is not eligible (6.5).
- Tempo stores the number when the issuer returns it, and nothing else.

### 5.4 Keeping financial records

Israeli businesses keep invoices and receipts for at least 7 years
([Green Invoice](https://www.greeninvoice.co.il/magazine/accounting/saving_invoices/)). The exact count (from the
document's date, or from the end of the tax year or the filing of the return) is **to verify with the accountant**.
The legal duty is the studio's and the issuer holds the documents; Tempo keeps its own order, payment, refund and
document rows for **7 years from the end of the order's year** (section 9.3), so the studio can always match a
document to a booking.

## 6. The provider adapter

### 6.1 Interface sketch

`Modules/Commerce/Providers` (new), one implementation per provider, picked by `merchant_accounts.provider`:

```csharp
public interface IMerchantPaymentProvider
{
    string Key { get; }                                   // "fake", later the chosen provider
    ProviderCapabilities Capabilities { get; }            // documents, refunds, partial refunds, wallets, installments, signed webhooks

    Task<CheckoutSession> CreateCheckoutAsync(MerchantContext merchant, CheckoutRequest request, CancellationToken ct);
    // request: order id (as the provider's reference), amount, description, buyer name and email, max installments,
    // success/cancel return URLs under /s/<slug>/pay/..., an expiry (hold - 1 minute). Returns the hosted page URL
    // and the provider's checkout reference.

    Task<VerifiedEvent?> VerifyWebhookAsync(MerchantContext merchant, WebhookRequest request, CancellationToken ct);
    // Checks the signature (or confirms the event by a server-to-server query when the provider signs nothing) and
    // returns a normalized event, or null for an event that is not authentic.

    Task<RefundResult> RefundAsync(MerchantContext merchant, RefundRequest request, CancellationToken ct);
    // payment reference, amount, our idempotency key.

    Task<PaymentStatus> FetchStatusAsync(MerchantContext merchant, string providerReference, CancellationToken ct);
    // for the sweep, reconciliation and the return page's server-side check.
}

public sealed record VerifiedEvent(string ProviderEventId, MerchantEventType Type, Guid OrderId,
    string? PaymentReference, long? AmountAgorot, PaymentMethodInfo? Method, IssuedDocument? Document);

public enum MerchantEventType { PaymentSucceeded, PaymentFailed, RefundSucceeded, RefundFailed,
    DisputeOpened, DisputeWon, DisputeLost, DocumentIssued }
```

- `MerchantContext` carries the organization, the provider's merchant reference and a lazily loaded secret reader
  (6.4); the adapter never sees another studio's secrets.
- `IInvoicingService` (new, for `documents_by = 'invoicing_service'`): `IssueAsync(order or refund) -> IssuedDocument`
  and `FetchAsync(number)`.
- **`FakeMerchantProvider`**: no network, used in unit and integration tests and on dev behind a flag. Its "hosted
  page" is a dev-only route in `client-web` with "שלם" and "דחה" buttons that calls a dev-only API route to emit a
  signed fake webhook. It is never registered in production (a startup check and a test).

### 6.2 Webhook intake

- **Route:** `POST /webhooks/merchant/{provider}/{organizationId}` (new), on its own Lambda function and API Gateway
  route without the Cognito authorizer, as ADR-0004 and docs/28 section 6.2 say. The organization in the path tells
  the handler whose secret verifies the signature; it is not trusted until the signature is.
- In the request: size limit, verify, insert into `commerce.webhook_inbox` (unique on provider and event id, so a
  replay is a no-op), put a `commerce.webhook` message on the work queue (new `MessageTypes` value), answer 200.
  An unverified request answers 401 and writes a counter, never the payload.
- In the worker: load the inbox row, lock the order, apply the event idempotently (the state machine of 3.3 ignores a
  step already taken), write the financial event and the audit event, then fulfil, refund or request the document.
  Failures retry through SQS and land in the existing DLQ.
- **No transactional outbox is needed for this.** `OutboxMessageHandler` is still the Phase 0 skeleton and there is
  no outbox table. The order transaction writes the database only; side effects (the inbox item, the document call)
  run in the worker from the inbox row, and the daily reconciliation catches anything lost between the database and
  the queue. If a generic outbox is built later (docs/24 phase 4, "generic webhook intake"), this moves onto it.

### 6.3 Reconciliation

A daily `commerce.daily` worker message (new; one more EventBridge Scheduler schedule, free tier): for each active
merchant account, list yesterday's orders and refunds that are not final and call `FetchStatus`; apply what the
provider says when it is safe (paid at the provider, `awaiting_payment` here); write anything else to a mismatch row
and the owner's payments page. Holds that the lazy path missed are released here too.

### 6.4 Secrets per studio

- Provider and invoicing credentials live in **SSM Parameter Store SecureString**, standard tier, under
  `/tempo/<env>/merchant/<organizationId>/<provider>/<name>` (for example `api-key`, `webhook-secret`). Never in the
  repo, the database, logs, issues or PRs (D14).
- Standard parameters are free (AWS: up to 10,000 per account and region; *to re-check at build time*). The default
  `aws/ssm` key, no CMK (ADR-0021, ADR-0026).
- **Who writes them.** The repo rule is that a person writes secrets. Stage 2 (one or two pilot studios): an operator
  writes them by hand from the studio's provider dashboard. Stage 3 (self-serve): the owner pastes the key into
  "תשלומים באפליקציה" and the API writes the parameter with `ssm:PutParameter` limited to the
  `/tempo/<env>/merchant/*` path; that IAM change needs Kris's approval when it comes (M-15).
- The API and the webhook function read with `ssm:GetParameter` on that path only, cached for 5 minutes;
  `secrets_version` invalidates the cache on rotation.

### 6.5 Choosing a provider (criteria only; nothing is chosen)

| Criterion | Why | Must or nice |
|---|---|---|
| Per-merchant accounts for many studios under one integration (a platform or partner program, or each studio's own terminal with API keys) | The studio is the merchant (M-1) | Must |
| A hosted payment page reached by redirect, in Hebrew and right-to-left, on a phone | SAQ A (2.2), D15 | Must |
| Signed webhooks, or a server-to-server status query | 6.2 | Must |
| Full and partial refunds by API | 4.2 | Must |
| Issues receipts and tax invoice-receipts with allocation numbers, or works with an invoicing service | 5.2, 5.3 | Must (one of the two) |
| A sandbox Tempo can use at $0 | ADR-0021 | Must |
| No fixed fee to **Tempo** (the studio's own terminal fees are the studio's) | ADR-0021 | Must |
| Apple Pay, Google Pay and Bit on the hosted page | Member convenience (M-13) | Nice |
| Installments (תשלומים) | Larger passes (M-13) | Nice |
| Tokenized saved cards | Recurring memberships later (M-14) | Later |
| Dispute events by webhook | 4.4 | Nice |
| A .NET-friendly REST API without a required SDK | No SDK in the repo until chosen | Nice |

Candidate kinds to evaluate (examples, **not verified**: pricing, platform programs and API features must be checked
with each vendor at decision time):

| Kind | Examples to look at |
|---|---|
| Israeli gateways and acquirer-connected processors with hosted pages | Cardcom, Tranzila, Grow (Meshulam), PayPlus, Pelecard, CreditGuard |
| Invoicing services with an API (`documents_by = 'invoicing_service'`) | Morning (Green Invoice), iCount, EZcount, Rivhit |
| Global processors | Stripe does not appear to settle to Israeli businesses' local accounts (Globes, [en.globes.co.il](https://en.globes.co.il/en/article-1001381078), undated; the same open check as docs/28 B-1) |

docs/28 B-1 (Tempo's own provider) and this choice are separate decisions; one provider for both is allowed but not
required.

## 7. What changes in passes and the roster

### 7.1 Where a pass came from

`scheduling.passes.source` (new, 3.2) answers "how was this sold": `desk` (granted by staff, paid however the studio
records it), `app` (paid in the app, `order_id` set), `public_join` (the newcomer offer of docs/37), `referral` (the
bring-a-friend reward). The person card and the member's pass list show "נרכשה באפליקציה" for `app`.

### 7.2 "לתשלום בסטודיו" stays

- Everything "to pay at the studio" keeps working unchanged: the offer join (`passes.to_pay_at_studio`), events with
  `pass_required = false` (`bookings.to_pay_at_studio`), the public texts "נרשמים כאן, משלמים בסטודיו". A studio
  without an active merchant account, or with `sold_in_app = false` on a product, never shows a payment button.
- When the studio sells in the app, the public offer page and the event page offer **both**: "לתשלום עכשיו" and,
  if the owner keeps it on (new switch, default on), "משלמים בסטודיו". A member who pays gets no
  `to_pay_at_studio` mark; a member who does not, gets it as today.
- **A gap found while writing this (not a payments change):** the roster query
  (`ClassOperations.cs`, `b.to_pay_at_studio`) shows the chip only for event bookings. A class booked on a newcomer's
  pass that is `passes.to_pay_at_studio` shows no chip, and no screen in `admin-web` reads the pass flag. Proposed fix,
  independent of payments: the roster reads `b.to_pay_at_studio OR ps.to_pay_at_studio`, and the person card shows the
  chip on the pass, with "סימון כשולם" (`passes.manage`, new `POST /passes/{id}/paid`, audited) to clear it at the
  desk. One small PR, any time.

### 7.3 The roster

| Booking | Chip |
|---|---|
| `pending_payment` (a hold, 3.4) | "ממתין לתשלום" (neutral), counted in the places taken |
| Paid in the app (`order_id` set, or on a pass with `source = 'app'`) | "שולם באפליקציה" (neutral) |
| To pay at the studio (booking or pass) | "לתשלום בסטודיו" (warning), as today |
| A disputed order | "בבירור מול חברת האשראי", owners and admins only |

Instructors see the same chips without amounts.

### 7.4 Reports (docs/32)

docs/32 left revenue out ("no payments yet"). With payments, `GET …/reports/summary` gains, behind
`reports.view` **and** `payments.view`: paid in the app, refunded and net, per week and per kind (pass, drop-in,
event), and the count of places still "to pay at the studio". Desk sales are not money Tempo knows; the report says
so ("מכירות בדלפק לא נכללות") rather than guessing from `price_agorot`. Computed live under RLS like R-5. A CSV of
orders for the accountant is part of stage 3.

## 8. Member and console UX (high level)

All screens Hebrew and right-to-left, Warm Glass (D16), and complete at 360 px and 1280 px wide with touch and with
a keyboard (D15). Amounts in the `tp-num` style, "₪" after the number as elsewhere in the apps.

**Member app (`client-web`):**

1. A product or event shows "לרכישה · 450 ₪" (fictional price). The booking sheet of a class with no valid pass
   offers "כניסה חד־פעמית · 60 ₪" when the studio sells drop-ins, next to the existing "אין כרטיסייה בתוקף לשיעור הזה".
2. A checkout sheet: what she buys, the price with "כולל מע״מ" (licensed dealers and companies only), the studio's
   legal name ("הסטודיו מוכר, Tempo לא גובה"), the cancellation terms link, and one action "לתשלום". For a hold, a
   quiet countdown "המקום שמור לך עוד 9 דקות".
3. Redirect to the provider's page. Back on `/s/<slug>/pay/return`, the app asks the server for the order (never the
   redirect's parameters) and shows "מאשרים את התשלום..." until it is `fulfilled`, then "התשלום התקבל" with the pass
   or the class ticket. After 30 seconds without an answer: "התשלום בבדיקה, נעדכן אותך" and an inbox item later.
4. **"קבלות ותשלומים"** (the row in `ProfileScreen.tsx`) becomes a screen: her orders in this studio, newest first,
   with what, when, the amount, the state ("שולם", "הוחזר", "הוחזר חלקית") and a link "קבלה" or "חשבונית" to the
   issuer's document. Empty: "עוד לא שילמת באפליקציה". In a studio without payments the row stays hidden instead of
   "בקרוב".

**Console (`admin-web`):**

1. Settings, "תשלומים באפליקציה" (owner, `payments.settings.manage`): the business type, legal name and number, who
   issues documents, the connection state (stage 2: "החיבור נעשה על ידי צוות Tempo"), pause, and the per-product
   switch "נמכר באפליקציה" in the products settings.
2. "תשלומים" (`payments.view`): a list of orders with filters (period, kind, state), a card per order with the
   payments, refunds, documents and the bookings it produced; "החזר כספי" with the suggested amount (4.2). A table at
   1280 px, cards at 360 px.
3. The person card: her orders under her passes.

## 9. Security and privacy

### 9.1 Threats and controls

| Threat | Control |
|---|---|
| Card data in Tempo | Hosted page by redirect only; no card field in any Tempo form; logs never carry provider payloads (docs/20 section 7) |
| A forged "paid" (redirect tampering, a fake webhook) | Only verified webhooks or `FetchStatus` move an order; webhook signature per studio; amount and order id in the event must match the order |
| Replay | Unique `(provider, provider_event_id)`; the state machine is idempotent |
| One studio's event applied to another | The organization in the route selects the secret; the order is looked up under that tenant's RLS |
| Over-refund | `refunded_agorot <= amount_agorot` in a check and under a row lock; refund idempotency key |
| A staff member refunding to herself | Refunds go only to the original payment method (provider rule); `payments.refund` is owner and admin; step-up; audited |
| Open redirect on return | Return URLs are fixed paths under `/s/<slug>/pay/` (docs/36 L-7 rule) |
| Secrets leak | SSM only, path-scoped IAM, never echoed by any API; D14 |

### 9.2 Audit

New actions (docs/27 section 7, ids, states and amounts only, never card details): `merchant_account.updated`,
`order.created`, `order.paid`, `order.fulfilled`, `order.expired`, `order.refunded`, `refund.requested`,
`refund.succeeded`, `refund.failed`, `dispute.opened`, `dispute.closed`, `document.issued`, `document.failed`,
`pass.marked_paid`.

### 9.3 Retention, erasure and export

- Orders, payments, refunds, documents and financial events are kept **7 years from the end of the order's year**
  (5.4; the exact rule *to verify*), then deleted by the existing retention job (`RetentionPolicy`, new entries).
- **Erasure** (docs/27 section 4.7) anonymizes the person and clears `refunds.note`; the money rows stay with the
  anonymized person id, because the studio must keep its financial records. The member is told this in the delete
  dialog (a line next to "מה נשאר בסטודיו").
- **Export** adds her orders and document links.
- The webhook inbox keeps a minimized payload (ids, amounts, states; the provider's personal fields are dropped
  before insert) for 90 days.

### 9.4 The public repo

Every example, fixture and screenshot uses fictional studios and people ("סטודיו נשימה", "דנה כהן"), fictional
amounts, `example.com` addresses and fake provider references (`fake_pay_0001`). No real business numbers: fixtures
use an obviously fake number such as `000000000`.

## 10. Stages

Every stage is $0 for Tempo until a paying studio; a studio's own terminal fees are the studio's.

| Stage | What | Needs | Cost to Tempo |
|---|---|---|---|
| **0** | This document; the small roster gap fix of 7.2 | Kris's answers | $0 |
| **1** | The `commerce` migration, the order state machine, holds, refunds, the fake provider and its dev-only hosted page, the member checkout and "קבלות ותשלומים", the console's payments page, behind the per-studio flag `merchant_payments` (off), on dev only | Kris's go (M-15); no provider | $0 (one free Scheduler schedule) |
| **2** | One real provider adapter and, if needed, one invoicing adapter, against their sandboxes; the webhook function live on dev; an operator connects a pilot studio by hand | A provider chosen by Kris (6.5); a free sandbox (*to verify per provider*) | $0 |
| **3** | The first studio takes real payments in production; reconciliation alarms; the accountant's CSV; self-serve connection (the IAM change of 6.4) | A studio that wants it, its own merchant account, production (K4), the lawyer's texts (#306) | $0 for Tempo; GuardDuty's tripwire (ADR-0021) fires with the first paying studio anyway |
| **4** | Wallets and Bit, installments, saved cards and recurring memberships (M-13, M-14), revenue charts | Demand from studios | Per provider |

## 11. Tests

- **Unit:** the order state machine (every allowed and refused step); hold arithmetic and expiry with a fake clock;
  pro-rata refund suggestion; VAT split for each business type; the fake provider's signature check; mapping of
  provider failure codes; the startup check that refuses `fake` in production.
- **Integration (PostgreSQL 18, as docs/29 section 13):** RLS on every `commerce` table; **20 members paying for the
  last 3 places** give exactly 3 holds and 17 `session.full`; the same webhook delivered 5 times in parallel fulfils
  once (`entries_used`, one pass, one booking); a payment after an expired hold with no place refunds once; refunds
  in parallel never exceed the amount; a class cancelled during a hold; `entries_used = count(held uses)` after every
  scenario, as today.
- **API flow:** member buys a pass, books with it, cancels in the free window, the owner refunds in part; the event
  path; the return page with a delayed webhook.
- **e2e (Playwright, fictional people, D15 sizes):** checkout against the fake hosted page at 360 and 1280 px, axe
  clean (Q-2), "קבלות ותשלומים" with a document link.
- **Contract:** recorded webhook fixtures per provider (fictional data) when stage 2 starts.

## 12. Telemetry

Structured logs and metrics only, no new alarm in dev (ADR-0021: the ten prod alarms are taken):

- counters: checkouts started, paid, failed by code, expired, holds lost (M-5), refunds, disputes, webhook signature
  failures, document failures;
- timings: checkout to fulfilled, webhook to fulfilled;
- reconciliation mismatches per day. In production, a mismatch or a signature-failure burst folds into an existing
  alarm (the worker errors alarm) rather than a new one, until Kris approves an eleventh.

Logs carry ids, states, amounts and provider codes; never names, emails, card data or raw payloads.

## 13. Risks

- **Legal.** Payment-services licensing (2.1), consumer cancellation rights (4.3) and document rules (5) must be
  confirmed by a lawyer and an accountant before stage 3. Stage 1 needs none of it.
- **A provider without signed webhooks.** Confirm each event with `FetchStatus` before applying it (as docs/28 section 13).
- **Two systems of record for money.** The issuer's documents are the legal record; Tempo's rows are the product's.
  Reconciliation and the accountant's CSV keep them matched.
- **Holds keep places from others.** Ten minutes and a cap of one live hold per member per session limit it.

## 14. Open questions for Kris

Each has a default that applies unless Kris changes it.

| Id | Question | Default | Why |
|---|---|---|---|
| M-1 | Who is the seller, and does money ever pass through Tempo? | The studio is the merchant of record; money goes from the member to the studio's provider account; Tempo never holds it | No payment licence, no chargeback liability, no VAT on studios' sales for Tempo |
| M-2 | Does Tempo take a fee per sale? | No. If ever, it is billed to the studio through docs/28, never split from the member's payment | Keeps Tempo out of the money flow (M-1) |
| M-3 | What is a drop-in? | A one-entry card the studio marks `drop_in`, bought and booked in one step | Reuses passes and the ledger; the free window works unchanged |
| M-4 | Hold the place while the member pays? | Yes, 10 minutes, shown as "ממתין לתשלום" on the roster | Nobody pays for a class that filled meanwhile; 10 minutes is enough for a card or a wallet |
| M-5 | Payment arrives after the hold expired and the class is full | Book if a place is free, else automatic full refund and an inbox item | The member must never pay for nothing |
| M-6 | Who issues receipts and tax invoices, and for which studios? | The provider when it can issue them with allocation numbers, else the studio's own invoicing service; Tempo never issues. All three studio types from stage 1: receipt for עוסק פטור, חשבונית מס-קבלה for עוסק מורשה and companies | Tempo is not registered bookkeeping software; the document kind is a setting, not a separate build |
| M-7 | Who may refund, and within what window? | Owners and admins (`payments.refund`), with a recent sign-in, any time the provider allows; no automatic refunds except M-5 and M-10 | The studio is the merchant and owns refund decisions; admins run the desk |
| M-8 | Partial refunds? | Allowed; the console suggests a pro-rata amount; the pass is kept unless staff void it | Studios already refund unused entries by hand |
| M-9 | A member cancels a paid drop-in or event place in the free window | Drop-in: the entry returns to her one-entry pass, no money back automatically. Event: the place is freed, a refund only if the studio gives one | Matches how cards work today; money decisions stay with the studio |
| M-10 | The studio cancels a class | Drop-in: the entry returns (as docs/29 C-8). Event: automatic full refund | An event has no pass to return the entry to |
| M-11 | Chargebacks | The order is marked disputed, the owner is notified, the pass stays; evidence in the provider's dashboard | Voiding automatically would punish members for a bank's process |
| M-12 | Currency and VAT on prices | ILS only; the price the studio enters is the gross price the member pays, VAT included for licensed dealers and companies (18% today) | Members compare gross prices; one currency keeps documents simple |
| M-13 | Payment methods | Card, one charge, by redirect to the hosted page; Apple Pay, Google Pay and Bit when the chosen provider's hosted page offers them at no fixed cost; installments off (a studio setting later) | Smallest PCI scope; wallets cost nothing extra if the page has them |
| M-14 | Recurring memberships (a charge every month until cancelled) | Not in stages 1 to 3; a membership is paid once for its `valid_days` | Needs saved cards, retries and dunning: a later, separate design |
| M-15 | When to build, and who connects a studio | Stage 1 starts when a pilot studio asks to take payments in the app (it is $0, but it is maintenance); stage 2 waits for Kris to choose a provider; until self-serve, an operator writes a studio's secrets in SSM by hand | ADR-0021, and the repo rule that a person writes secrets |

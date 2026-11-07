# Runbook: billing operations before the provider (draft)

**Draft for Kris.** Written on 2026-11-07 (board #627, for #547). It records what the code does today and proposes the
manual procedure of `docs/runbooks/production-readiness.md` section 7. It decides nothing: prices, the invoicing
service and the document type are open, and it has had no dry run.

## What the code does today

- A new studio opens with an **`active`** subscription on the free `pilot` plan, one month from creation
  (`BillingService.OpenForNewStudioAsync`). Not `trialing`, although `docs/28_Billing_and_Entitlements_LLD.md` section 4
  says a studio starts there.
- **Nothing changes a subscription after that.** The only write to `billing.subscriptions` in the code is that insert. No
  job ends a period, starts a grace or moves a studio to `restricted`, and no route does it either. The pilot's period
  ends and nothing happens.
- **The operator has no route for it.** The console can suspend, reactivate, force an owner transfer and delete a
  studio. The routes in docs/28 (`billing/overrides`, `billing/trial-extension`) are not built.
- Restricted mode works if the state is set: the tenant filter answers 402 `billing.restricted` (`TenantRouteFilter`).
- `platform_role` can already write `billing.subscriptions` and insert into `billing.subscription_events`, whose
  `actor_type` allows `operator`. An operator route needs no new grant.
- `billing.plans` holds only `pilot` (migration 0009). There is no paid plan to move a studio to, and adding one is a
  migration (B-6).

So section 7's "the operator moves its subscription to `active` by hand, and each change is audited" has nothing behind
it yet. A studio is `active` already; what is missing is a paid plan, a period that means something, and a way to change
either with an audit line.

## Decisions this waits for

| # | Decision | Owner |
|---|---|---|
| 1 | The price list, and a paid plan row (B-6) | Kris |
| 2 | The invoicing service and its fee (no fixed fee preferred) | Kris |
| 3 | The document type: tax invoice or receipt | The accountant |
| 4 | How the state changes before the provider: a small operator route (proposed), or SQL by the owner in Neon | Kris |
| 5 | Whether unpaid studios are restricted automatically or by hand during the first months | Kris |

On 4: an operator route gives the audit line section 7 promises, and it is ordinary code. SQL by hand gives none unless
the `subscription_events` row is written by hand too.

## Proposed procedure, per studio and period

Assumes decision 4 is the route, and bank transfer as the default of section 7.

1. **Invoice.** Issue the document from the invoicing service to the billing details on the studio's billing page
   (`billing_accounts`: legal name, business id, email).
2. **Payment received.** Match the transfer to the document. Record the date and the document's number in the invoicing
   service, not in Tempo.
3. **Subscription.** Set the plan and the new period through the operator console. The event records the operator, the
   cause and the document's number.
4. **Late payment.** Reminders are not built, so the operator writes to the owner by hand: the first time when the
   period ends, again after 7 days. After that, decision 5.
5. **Refund.** A credit document in the invoicing service and a bank transfer back; the subscription moves only if the
   studio leaves. No refund code exists.
6. **Leaving.** The owner exports the studio's data first. Invoices don't live in Tempo, so the accounting records stay
   in the invoicing service.

## Dry run on dev

The acceptance in section 7, once decision 4 exists: one fictional studio through steps 1 to 5 with a test document,
then check the event, the audit line and that restricted mode blocks and releases writes.

## Related

- `docs/28_Billing_and_Entitlements_LLD.md`, `docs/runbooks/production-readiness.md` section 7, #278, #547

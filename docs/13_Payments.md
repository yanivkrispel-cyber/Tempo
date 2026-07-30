# Merchant Payments and Commerce

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Scope

Organizations charging clients. Separate from Platform Billing.

## 2. Model

- MerchantAccountConnection.
- Customer.
- ProductOffering.
- Price.
- Order/OrderLine.
- PaymentIntent/PaymentAttempt.
- Refund.
- MerchantSubscription.
- Invoice/ReceiptReference.
- PaymentMethodReference.
- immutable financial event history.

## 3. Flow

```text
Create Order
→ Validate offering
→ Create Payment Intent
→ Provider token/hosted flow
→ Webhook
→ Normalize settlement
→ Mark paid
→ Issue vertical benefit idempotently
→ Generate tax document
```

## 4. States

```text
Created → RequiresAction → Processing → Succeeded
                          ↘ Failed
Succeeded → PartiallyRefunded → Refunded
```

## 5. Integrity

- minor units.
- never trust redirect as settlement.
- refunds bounded by captured amount.
- benefit linked to order line.
- daily reconciliation.
- immutable adjustment history.

## 6. Security

Tokenization only, signed webhooks, least-privilege provider keys, finance permissions and audited refunds.

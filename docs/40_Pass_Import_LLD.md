# Pass Import LLD (moving a studio's pass balances over)

> **Status:** Proposed defaults PI-1 to PI-9 of board #584 (DAY-PLAN-20, decision PL-2, 2026-11-03). They apply
> unless Kris changes them on the board.
> **Audience:** Kris, Ofir, the agents.
> **Related:** docs/34 (the people import this follows, and copies the shape of), docs/29 sections 5 and 16 (passes,
> products, freezes), docs/27 (people and contact points), ADR-0021 ($0).
> **Migration:** 0041 (one column). 0040 belongs to #561.

A studio that switches brings its members **and what they have already paid for**: a card with 6 entries left, a
membership valid until the end of March. The pre-mortem's top risk is "studios won't switch", and today the
people import (docs/34) brings people only, so the owner would have to grant every open pass by hand at the desk.
This document adds a checked import of pass balances, run after the people import, with the same check-then-import
flow.

## 1. Scope

In: one CSV of open passes per run, each row naming a person already in the studio, one of the studio's pass
products by name, the entries left (a card) and the dates; a dry run and the import; `source = import` on each pass
made this way.

Out: money (no price, no payment, no receipt), past bookings and attendance, used-up or expired passes, freezes,
creating people or products on the fly, `.xlsx`, uploads to the server, an import from another system's API.

## 2. Decisions

| Id | Decision |
|---|---|
| PI-1 | `POST …/passes/import { dryRun, rows }`, the route needs `people.import` (owner, admin) and the service also checks `passes.manage`. No new permission key. |
| PI-2 | The console reads the CSV in the browser, as docs/34 I-2 (same separators, encodings, 2 MB and 1,000 rows). Only JSON rows reach the API; no file is stored. More than 1,000 rows is 400 `import.too_many_rows`. |
| PI-3 | A row's fields: `email`, `phone`, `product`, `entriesLeft`, `validFrom`, `validUntil`, plus `line`. **No money column.** |
| PI-4 | The person is found by email or phone among the studio's contact points (as docs/34 step 3). The row never creates a person: run the people import first. A contact can sit on two active people (`contact_points.value` is not unique); such a row is `person.ambiguous` rather than a guess, and the studio fixes it on the people page. |
| PI-5 | The product is found by name among the studio's **active** products, ignoring case and outer spaces. The row never creates a product. |
| PI-6 | A card keeps the product's size: `entries` = the product's entries and `entries_used` = entries minus `entriesLeft`, so the member sees "6 of 10 left". A membership takes no `entriesLeft`. |
| PI-7 | `validUntil` is required; `validFrom` defaults to the studio's today. The pass runs from `validFrom` to `validUntil`, inclusive, whatever the product's length. |
| PI-8 | Running the same file twice adds nothing: a row whose person already has an active **imported** pass of the same product ending the same day is `exists`. The day compared is the one the file gave: a freeze moves `ends_on`, so its frozen days come off before the match, and a frozen pass is still found. Two consequences, both on purpose: a pass from an earlier run that the desk voided is created again by the next run (it is no longer active), and a row with a corrected `entriesLeft` and the same key stays `exists` and changes nothing, so a wrong balance is fixed at the desk on the person's card. |
| PI-9 | Migration 0041 adds `scheduling.passes.source` (`desk` or `import`, default `desk`). `Pass.source` is in the API, so the person's card and the member's passes can say "יובא". Audit: `pass.granted` per pass with `source: import` and one `passes.imported` with the totals; no names, emails or phones. Nothing is sent to the member. |

## 3. The request

```json
{ "dryRun": true, "rows": [ { "line": 2, "email": "dana@example.com", "phone": null, "product": "כרטיסיית 10",
  "entriesLeft": "6", "validFrom": "", "validUntil": "31/03/2027" } ] }
```

Cells go as the file has them, trimmed; `entriesLeft` is a string, because a file can hold anything. Dates take the
formats of docs/34 section 4 (`dd/mm/yyyy`, `d/m/yyyy`, `d.m.yyyy`, `yyyy-mm-dd`).

## 4. Checks per row (the first failure wins)

| # | Check | Outcome when it fails: `field` / `code` |
|---|---|---|
| 1 | Phone and email read as in `createPerson` (`ContactValues`) | `phone` / `phone.invalid`, `email` / `email.invalid` |
| 2 | At least one of them | `contact` / `contact.required` |
| 3 | A live person in this studio has it | `person` / `person.not_found` |
| 4 | Email and phone don't point to two different people, and neither sits on two active people | `person` / `person.ambiguous` |
| 5 | The person is active (not archived, merged or anonymized) | `person` / `person.read_only` |
| 6 | `product` is given and names exactly one active product | `product` / `required`, `product.not_found`, `product.ambiguous` |
| 7 | A card: `entriesLeft` is a whole number from 1 to the product's entries | `entries_left` / `required`, `entries_left.invalid`, `entries_left.too_many` |
| 8 | A membership: `entriesLeft` is empty | `entries_left` / `entries_left.not_allowed` |
| 9 | `validUntil` is a real date, not before the studio's today, at most 730 days ahead | `valid_until` / `required`, `date.invalid`, `valid_until.past`, `valid_until.too_far` |
| 10 | `validFrom`, when given, is a real date and not after `validUntil` | `valid_from` / `date.invalid`, `valid_from.after_until` |

A row that passes is then, in this order:

- `duplicate_in_file` (with `duplicateOfLine`) when an earlier valid row has the same person and product;
- `exists` (with `passId`) when the person has an active pass with `source = import`, that product and that
  `ends_on` before any freeze (PI-8);
- otherwise `valid` (dry run) or `created` (with `passId`).

The result is the people import's shape: `{ dryRun, importId, totals: { rows, valid, created, exists,
duplicateInFile, invalid }, rows: [ { line, outcome, personId, passId, duplicateOfLine, field, code } ] }`.

## 5. How it runs

One transaction as the app role with `app.organization_id` set (RLS), every statement also filtered on
`organization_id = $1`, and a fixed number of statements whatever the row count:

1. Rows are checked in memory (section 4, checks 1, 2 and 7 to 10 that need no database read).
2. One query maps every normalized email and phone to its person (`people.contact_points` joined to
   `people.people` for the status), as docs/34 step 3. A person in another studio is never found: RLS hides it, and
   the filter on `organization_id` says so again.
3. One query reads the studio's active products.
4. One query reads the active imported passes of the persons found (`source = 'import'`), for PI-8.
5. A dry run stops here.
6. One `INSERT … SELECT FROM unnest(…)` creates the passes: `entries` from the product (a card), `entries_used` from
   PI-6, `starts_on` and `ends_on` from PI-7, `status = 'active'`, `granted_by` the caller's membership, `source =
   'import'`, ids from `Guid.CreateVersion7()`. The schema's checks (`entries_used BETWEEN 0 AND entries`,
   `ends_on >= starts_on`) hold by section 4.
7. One `INSERT … SELECT` writes a `pass.granted` audit entry per pass (`personId`, `productId`, `source`,
   `importId`) and one `passes.imported` entry with the totals.

## 6. What it never does

- It never changes or voids a pass that is there, never merges people, never creates a person or a product.
- It records no payment and no price. A studio that wants a price on record keeps it in its old system.
- It books nothing and sends nothing: no inbox item, no push.
- It stores no file and logs no row: the log carries counts and the import id only.

## 7. Database (migration 0041)

```sql
ALTER TABLE scheduling.passes
    ADD COLUMN source text NOT NULL DEFAULT 'desk' CHECK (source IN ('desk', 'import'));
```

Every pass there today is `desk`; the intro pass from a public join (docs/37) stays `desk` too, marked by its
`to_pay_at_studio`. No new table, so studio removal and erase need no change. The PI-8 lookup uses
`ix_passes_person (organization_id, person_id, ends_on)`.

## 8. API (contract first)

- `POST /api/v1/organizations/{organizationId}/passes/import`, `importPasses`: `ImportPassesRequest` →
  `ImportPassesResult` (200), 400, 401, 402 (the studio is in restricted mode), 403, 404.
- `Pass` gains `source` (`desk` or `import`), always sent.

## 9. The console (O3)

Passes, **ייבוא כרטיסיות ומנויים**, beside the people import and with the same steps: choose the file, match the
columns (email, phone, product, entries left, valid from, valid until), **Check**, then **Import**. Each invalid row
shows its reason in Hebrew. The page says to run the people import first, and lists the studio's product names, so
the file can use them.

## 10. Tests

Integration tests, written first, against a migrated database:

- a dry run returns every outcome of section 4 and writes nothing;
- an import creates the passes with `source = import`, the product's entries and the right entries used;
- a second run of the same rows gives `exists` for each and creates nothing;
- a person and a product of another studio are never found (`person.not_found`, `product.not_found`);
- the audit holds one `pass.granted` per pass and one `passes.imported`, with no email or phone in either.

API tests: the route needs `people.import`, a caller without `passes.manage` is refused, and 1,001 rows is 400.

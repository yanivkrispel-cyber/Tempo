# Whole-Studio Export (proposal)

> **Status:** proposed, for Kris. Nothing here is decided and no code exists. Board #612, KR-8.
> **Audience:** Kris, Ofir, the agents, and the lawyer for section 6.
> **Related:** docs/27 section 4.7 (one person's export), docs/31 section 11 (health in that export), docs/34 sections
> 6 and 9 (escaping, notes), `docs/runbooks/production-readiness.md` item 9a.

## 1. The gap

Today Tempo exports one person at a time (`POST /people/{personId}/export`, JSON, `people.export` with step-up). When a
studio leaves, the operator can remove it and every row it owns (migration 0023), but nothing hands the studio its data
first. The readiness list's default is an operator-run export script before removal. This proposal says what that
export should be.

## 2. What the export holds

One archive for one studio, taken from a single consistent read.

| File | Holds |
|---|---|
| `people.csv` | Each person: name, contacts, status, tags, consent state |
| `notes.csv` | Staff notes, author by role, as in the person export (docs/34 section 9) |
| `passes.csv` | Passes with product, dates, balance, status, freezes |
| `products.csv` | The studio's products |
| `classes.csv` and `sessions.csv` | The schedule, past and future |
| `bookings.csv` | Bookings and attendance |
| `README.txt` | The studio, the time of the export, and what each file means, in Hebrew |

**Left out by default:**

- Health declarations (section 6).
- Audit logs, tokens, Cognito identifiers and internal ids that mean nothing outside Tempo. A stable per-export row id
  links the files instead.
- Pictures. They can follow as a second step if a studio asks.

## 3. Format

CSV in UTF-8 with a BOM, so Excel shows Hebrew correctly, zipped. CSV because a studio's next system imports it, and
the owner can open it. The person export stays JSON: it answers a different need, one person's copy of their data.

## 4. CSV escaping

docs/34 section 6 stores a value that starts with `=`, `+`, `-` or `@` as typed and requires any CSV export to escape
it. So every text cell goes through one writer:

- A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`.
- Quoting follows RFC 4180: a cell with a comma, a quote or a line break is quoted, and a quote inside is doubled.
- Numbers and dates are written by the exporter from typed columns, so a real negative balance isn't escaped.
- A test feeds each starting character through the writer. Hebrew names, commas and line breaks are in the same test.

## 5. Who may run it

**Proposed:** the operator only at first, on the studio's written request, as the readiness list's default says. One
studio leaving is rare before revenue, and an operator run needs no new screen.

- Each run needs a recent sign-in and writes an audit row: who, which studio, when, the row counts. Never the content.
- The archive goes to the studio's owner only, over a short-lived link, and isn't kept after that.
- A self-service button for the owner is a later step. It would need a background job, a new permission and a place to
  hold the file, so it needs its own cost check under ADR-0021.

## 6. For the lawyer: health data

Health declarations are the sensitive part, and the person export gives them only to a member who holds the health
permission (docs/31 section 11). Three questions, with the proposal's default in brackets:

1. May a studio receive its members' declarations in bulk when it leaves? [Not until the lawyer answers.]
2. If yes, is it enough that the studio is the data owner, or does each person need to be told or to consent?
3. If a declaration stays out of the export, what happens to it when the studio is removed, given the retention in H-8?

## 7. Open for Kris

1. Is the file list in section 2 right?
2. Operator-run first, as in section 5, or the owner's button from the start?
3. Should the export be a condition of removal, so that no studio is removed before it's offered one?
4. Does the wording in the pilot's terms need to mention this? That is a question for the lawyer too.

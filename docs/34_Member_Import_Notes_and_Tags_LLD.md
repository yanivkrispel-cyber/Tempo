# Member Import, Notes and Tags LLD (import from a file, staff notes, tags)

> **Status:** Proposed defaults I-1 to I-8 and N-1 to N-7 of day board #321 (DAY-PLAN-7, 2026-10-17). They apply
> unless Kris changes them on the board. One choice is this document's own reading and is marked **(reading)**.
> **Audience:** Kris, Ofir, the agents.
> **Related:** ADR-0021 ($0 until revenue), docs/27 (people, contact points, duplicates, erase, export, merge),
> docs/31 (health data stays in the declaration), docs/32 section 10 (studio removal walks the catalog),
> docs/12 (CRM: this is its smallest useful piece), D15 (every screen on a phone and a computer).
> **Numbering:** `docs/33` is the Studio Experience LLD of #322. Migrations 0024 and 0025 belong to this document;
> #322's plan moves to 0026 and up.

A studio that moves to Tempo has its members in a spreadsheet or another system. Typing a hundred people by hand
is the first thing that stops a pilot. Once they are in, staff want to write a line on a person ("prefers the front
row", "paid cash for ten") and to group people ("morning", "imported 17.10"). This document adds three things: a
checked import of people from a file the console reads, staff notes on a person, and the studio's tags.

## 1. Scope

In:

- `people.import` (owner, admin; migration 0024) and `POST …/people/import` with a dry run (I-1 to I-7);
- the studio's tags and tags on people, `people.tags.manage` (N-1, N-2);
- staff notes on a person, `people.notes.view`, `people.notes.manage`, `people.notes.moderate` (N-3, N-4);
- tags and notes in erase, merge, export and studio removal (N-6);
- a tag for an import's batch (I-8).

Out: `.xlsx` files, uploads to the server, importing passes, consent, attendance or history, an import from
another system's API, rich text, attachments, editing a note, note visibility levels, leads, pipelines and CRM
tasks (docs/12), and any health information.

## 2. Decisions

| Id | Decision |
|---|---|
| I-1 | `people.import` for the `owner` and `admin` system roles (migration 0024). Not `staff` or `client`. |
| I-2 | CSV only (comma, semicolon or tab; RFC 4180 quotes; UTF-8 with or without BOM, or Windows-1255). Read **in the browser**; only JSON rows reach the API; the file is never uploaded or stored. At most 2 MB and 1,000 rows. No new npm dependency. |
| I-3 | Fields: display name, given name, family name, phone, email, birth date. A row needs a name and a phone or an email (P-6). The console proposes the mapping from Hebrew and English headers; the person importing can change it. |
| I-4 | `POST …/people/import { dryRun, rows, tagId? }`, at most 1,000 rows. One outcome per row: `valid`/`created`, `exists`, `duplicate_in_file`, `invalid`. A dry run writes nothing; a commit creates the good rows in one transaction with `source = import`. Set-based SQL, well inside the 30-second API limit. |
| I-5 | Email or phone match: `exists`, nothing changes. Name and birth date only: created and flagged as a duplicate candidate. |
| I-6 | No consent, no invitation, no email, no push. |
| I-7 | `person.created` (with `source: import`) per person and one `people.imported` with the totals; no names, emails or phones in the audit or the log. |
| I-8 | `tagId` puts one existing tag on every created person (I3). |
| N-1 | A studio's tags: name 1 to 30 characters, unique ignoring case; colour 1 to 6. At most 100 per studio and 20 per person. Deleting a tag takes it off everyone. |
| N-2 | `people.tags.manage` (owner, admin) creates, renames, recolours and deletes tags. `people.manage` puts a tag on a person or takes it off. `people.view` sees tags. |
| N-3 | A note is plain text, 1 to 1,000 characters, with author and time, newest first. No editing, so no edit history. |
| N-4 | `people.notes.view` and `people.notes.manage` (owner, admin, staff), `people.notes.moderate` (owner, admin). `manage` adds and deletes the caller's own; `moderate` deletes any. `client` gets none. |
| N-5 | No health information in notes. Notes are never in reports, notifications or the audit log. |
| N-6 | Erase deletes notes and tag links; merge moves them; the export carries tags and notes (author by role); studio removal deletes them. |
| N-7 | Routes in section 12; tables `people.tags`, `people.person_tags`, `people.person_notes` with RLS like the other `people` tables. |

## 3. Permissions

Migration **0024** (I2):

```sql
INSERT INTO authz.role_permissions (role_id, permission_key) VALUES
    ('00000000-0000-7000-8000-000000000001'::uuid, 'people.import'),   -- owner
    ('00000000-0000-7000-8000-000000000002'::uuid, 'people.import');   -- admin
```

Migration **0025** (N1) adds the tables of section 10 and:

| Key | Owner | Admin | Staff | What it allows |
|---|---|---|---|---|
| `people.tags.manage` | yes | yes | no | Create, rename, recolour and delete the studio's tags |
| `people.notes.view` | yes | yes | yes | Read the notes on a person |
| `people.notes.manage` | yes | yes | yes | Add a note, delete your own |
| `people.notes.moderate` | yes | yes | no | Delete anyone's note |

Each key joins `Permissions.Catalog` with its text, `SystemRoles.Admin` and `SystemRoles.Staff` gain theirs, and the
owner holds every key already. A custom role can carry any of them. Putting a tag on a person reuses
`people.manage`; seeing tags reuses `people.view`, because a tag is part of the person record the caller can
already read.

## 4. The import request

The console (K2) reads the file and sends cells as the file has them, trimmed, each with its `line` number. The API
does every check, so the console and the API never disagree about a row; the dry run is the console's preview.

Per row, in this order (the first failure wins):

1. **Name.** `displayName`, or `givenName` and `familyName` joined with a space. Empty: `invalid`,
   `display_name` / `required`. Over 100 characters: `too_long`.
2. **Phone.** `ContactValues.Phone` (E.164, Israel by default, as `createPerson`). Unreadable: `phone` /
   `phone.invalid`.
3. **Email.** `ContactValues.Email` (lower case). Unreadable: `email` / `email.invalid`.
4. **Contact.** Neither phone nor email: `contact` / `contact.required` (P-6).
5. **Birth date.** `dd/mm/yyyy`, `d/m/yyyy`, `d.m.yyyy` or `yyyy-mm-dd`, a real date, not in the future and not
   before 1900. Anything else: `birth_date` / `birth_date.invalid`. Empty is fine.

A request with no rows or more than 1,000 is 400 `import.too_many_rows` (or the usual validation error for none).
Plan limits: the free `pilot` plan has no limit on people today; if one is added, the import checks it once for
the whole batch and answers 403 `entitlement.limit_reached` before writing anything.

## 5. How the import runs (set-based, under RLS)

The transaction runs as the app role with `app.organization_id` set to the studio, like every tenant route, so RLS
limits every read and write below to that studio. Every statement also filters on `organization_id = $1`
explicitly, as the rest of the people module does.

1. **Rows are checked in memory** (section 4). Valid rows get their normalized phone and email.
2. **Repeats inside the file.** Walking the rows in order, a row whose normalized email or phone was already
   seen on an earlier valid row is `duplicate_in_file`, with `duplicateOfLine`.
3. **Matches in the studio.** One query for all remaining rows:

   ```sql
   SELECT cp.type, cp.value, cp.person_id
   FROM people.contact_points cp
   JOIN unnest($2::text[], $3::text[]) AS v(type, value) ON v.type = cp.type AND v.value = cp.value
   WHERE cp.organization_id = $1;
   ```

   A row with a hit is `exists`, with that `personId`. Contact points of erased people are deleted (docs/27 section
   4.7) and a merged record's move to the survivor, so a hit is always a live record. RLS: a person in studio B never
   matches in studio A, because `contact_points` is visible only for `app.organization_id`.
4. **Dry run** stops here: the rest are `valid`. Step 6 still runs as a read, so `possibleDuplicate` is shown.
5. **Create.** One `INSERT … SELECT FROM unnest(…)` for `people.people` (status `active`, `source = 'import'`, ids
   from `Guid.CreateVersion7()` made in C#), and one for `people.contact_points` (each as the primary of its type,
   not verified). With `tagId` (I3), one more for `people.person_tags`.
6. **Duplicate candidates** by name and birth date (docs/27 section 4.6), in one `INSERT … SELECT`: each created
   person against the studio's other live people (and the other created rows) with the same `lower(display_name)`
   and `birth_date`, both dates not null, reason `name_birth_date`, skipping pairs already open.
7. **Audit** in one `INSERT … SELECT`: a `person.created` entry per created person, `data = {"source": "import",
   "importId": …}`, and one `people.imported` entry with `data = {"importId", "rows", "created", "exists",
   "duplicateInFile", "invalid", "tagged"}`. No names, emails or phones.

The statement count is fixed (about eight), not per row. I2 times 1,000 rows against a local database and posts the
figure on the board; the target is under 5 seconds, against the API's 30-second limit.

## 6. What an import never does

- It never changes a person who is already in the studio (`exists` is read-only), never merges, and never links a
  login. A person who later joins by link is linked by the existing rule (docs/27 section 4.5): a person with no login
  whose verified-email contact matches.
- It records **no consent**: marketing stays not granted because nothing proves it; reminders are service messages
  (docs/27 section 4.3). The `import` method on consent rows stays unused.
- It sends nothing: no invitation, email or push (I-6).
- It stores no file and logs no row. A value that starts with `=`, `+`, `-` or `@` is stored as typed; **any future
  CSV export must escape such values** (spreadsheet formula injection).
- It imports no passes, attendance, history or health data.

## 7. Tags

- A tag is `{ id, name, color }`, `color` 1 to 6; the design system maps the six to tones that pass contrast (K2).
- The name is trimmed, 1 to 30 characters, unique in the studio ignoring case (a unique index on
  `(organization_id, lower(name))`): a clash is 409 `tag.name_taken`. A 101st tag is 409 `tag.limit_reached`.
- `POST …/people/{personId}/tags/{tagId}` is idempotent; a 21st tag on one person is 409
  `person.tag_limit_reached`. Tagging a merged or anonymized record is 409 `person.read_only`, as other writes.
- `DELETE …/tags/{tagId}` removes the tag and every link to it in one transaction.
- `Person.tags` lists the person's tags by name on `getPerson` and `listPeople`, read in one extra query per page
  (no N+1). `GET …/people?tag={tagId}` keeps people who have that tag; an unknown tag id gives an empty page.

## 8. Notes

- `body` is plain text, trimmed, 1 to 1,000 characters. The console shows it as text, never as HTML.
- Each note keeps `author_membership_id`, the author's system role at the time (`owner`, `admin` or `staff`; a custom
  role is stored as `staff`) and `created_at`. If the author's membership row is removed, the id becomes null and
  the note stays.
- `GET …/notes` returns newest first, keyset paged like other lists, with `mine` so the console knows which delete
  buttons to show. Delete: the author with `people.notes.manage`, anyone with `people.notes.moderate`; otherwise
  403.
- **Not for health information.** The note box says so and points to the health declaration (docs/31). The API
  cannot tell health text from other text, so this is a rule for people, stated on screen and in the onboarding
  runbook.
- Notes appear nowhere else: not in reports, notifications, search, the member app or the audit log.

## 9. Erase, merge, export and studio removal

| Operation | Notes | Tag links |
|---|---|---|
| Erase (docs/27 section 4.7) | deleted | deleted |
| Merge (section 4.6) | moved to the survivor | moved; a tag the survivor has is not doubled |
| Export (`people.export`) | included: text, date, author by role only | included: names |
| Studio removal (docs/32 section 10) | deleted by the catalog walk | deleted, and the studio's tags too |
| Account deletion (A-2) | kept: the person record stays with the studio | kept |

**(reading)** The export carries staff notes. The export is the person's copy of what the studio keeps about them
(the right of access in Israel's Privacy Protection Law), and a note is about them. The author is shown by role so a
staff member's name doesn't travel. A pass's short note stays out of the export as today (docs/29). Kris confirms
this with the lawyer under P-2; leaving notes out would be a one-line change in `ExportAsync`.

The removal test of A2 seeds one row in every tenant table and expects none after removal; N1 adds rows in the three
new tables to that seed, so a forgotten table fails the test.

## 10. Database (migration 0025)

```sql
CREATE TABLE people.tags (
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    id              uuid NOT NULL,
    name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
    color           smallint NOT NULL CHECK (color BETWEEN 1 AND 6),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX ux_tags_name ON people.tags (organization_id, lower(name));

CREATE TABLE people.person_tags (
    organization_id uuid NOT NULL,
    person_id       uuid NOT NULL,
    tag_id          uuid NOT NULL,
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id, tag_id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, tag_id) REFERENCES people.tags (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_person_tags_tag ON people.person_tags (organization_id, tag_id);

CREATE TABLE people.person_notes (
    organization_id      uuid NOT NULL,
    id                   uuid NOT NULL,
    person_id            uuid NOT NULL,
    author_membership_id uuid,
    author_role          text NOT NULL CHECK (author_role IN ('owner', 'admin', 'staff')),
    body                 text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    created_at           timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, author_membership_id) REFERENCES organizations.memberships (organization_id, id)
        ON DELETE SET NULL (author_membership_id)
);
CREATE INDEX ix_person_notes_person ON people.person_notes (organization_id, person_id, id DESC);
```

Grants and RLS follow `contact_points`: `SELECT, INSERT, UPDATE, DELETE` for `$app_role$` with one policy on
`organization_id = app.organization_id` for using and checking; `SELECT` for `$platform_role$`. There is **no self
clause** on any of the three: a member never reads tags or notes through RLS, whatever the API does. The limits of
100 tags and 20 per person are checked in the service inside the transaction (`SELECT count(*) … FOR UPDATE` on the
studio's tags or the person's row), not by a trigger.

## 11. Audit

| Action | Target | Data |
|---|---|---|
| `person.created` | person | `{ source: "import", importId }` |
| `people.imported` | organization | totals and `importId` |
| `tag.created`, `tag.updated`, `tag.deleted` | tag | `{ color }`, the fields changed, `{ peopleUntagged }` |
| `person.tagged`, `person.untagged` | person | `{ tagId }` |
| `person.note.added`, `person.note.deleted` | person | `{ noteId }` (and `{ byModerator }` on delete) |

A tag's name is a label the studio chose, not personal data, but it can still say something about people
("injured"), so the audit keeps ids only. Note text never reaches the audit log or the application log.

## 12. API

The contract has these operations marked `x-tempo-planned: true` until I2 and N1 build them:

| Operation | Route | Needs |
|---|---|---|
| `importPeople` | `POST …/people/import` | `people.import` |
| `listTags`, `createTag` | `GET`/`POST …/tags` | `people.view` / `people.tags.manage` |
| `updateTag`, `deleteTag` | `PATCH`/`DELETE …/tags/{tagId}` | `people.tags.manage` |
| `tagPerson`, `untagPerson` | `POST`/`DELETE …/people/{personId}/tags/{tagId}` | `people.manage` |
| `listPersonNotes`, `addPersonNote` | `GET`/`POST …/people/{personId}/notes` | `people.notes.view` / `people.notes.manage` |
| `deletePersonNote` | `DELETE …/people/{personId}/notes/{noteId}` | `people.notes.manage` (own) or `people.notes.moderate` |

`Person.tags`, `PersonExport.tags` and `PersonExport.notes`, and the `tag` filter on `listPeople`, are in the contract
already and arrive with N1. Every write here is a write on a studio route, so a restricted studio gets 402
`billing.restricted` (docs/28 section 4).

## 13. Apps (K2)

- **Import page** `/o/:slug/people/import` behind `people.import`: pick or drop a file; a preview of the first rows
  and the proposed mapping; the check (dry run) as a table that stacks into cards on a phone; the import; the
  totals and the created people linked to their cards. The page says the file stays on this device.
- **Person card:** tags as chips (add and remove with `people.manage`); notes newest first with the two hints (no
  health information; the person receives notes in their data export); delete where allowed.
- **Settings:** a Tags card for `people.tags.manage`. **People list:** tag chips and a tag filter.
- D15: every screen at 360 and 1280 px, right to left, by touch and by keyboard, using the primitives of docs/25
  section 9, and each new route in the `screens` e2e project.

## 14. Tests

- I2: dry run writes nothing; commit creates with `source = import` and the audit rows; `exists` changes nothing;
  `duplicate_in_file`; name-and-birth-date flagged; each invalid code; 1,001 rows is 400; 403 without
  `people.import`; RLS between studios; the same rows twice create nothing; `050-…` and `+972…` match; 1,000 rows
  timed locally.
- N1: the limits and the case-insensitive clash; staff tag but don't create tags; own and moderated note deletes; a
  client gets 403 everywhere; erase, merge and export as in section 9; A2's removal leaves no rows; audit without
  text; the `tag` filter; RLS between studios.
- K2: unit tests of the CSV reader, and Playwright `sync7` on dev at 360 and 1280 px (board #321, Z3).

## 15. Delivery plan (board #321)

| Step | What | Who |
|---|---|---|
| I1 | This document and the planned contract rows (SYNC 7a) | K1 |
| I2 | The import, migration 0024 | K1 |
| N1 | Tags and notes, migration 0025 (SYNC 7b) | K1 |
| I3 | `tagId` on the import | K1 |
| Z0 to Z3 | CSV reader, import page, tags and notes in the console, `sync7` | K2 |
| U7 | Runbooks and status | K1 |

## 16. Open items for Kris

- Whether staff notes belong in a person's export (section 9, **(reading)**), with the lawyer under P-2.
- Whether staff (not only owner and admin) may import (I-1).

# Studio Scheduling and Passes LLD (first vertical skeleton)

> **Status:** Draft for review, 2026-10-15. Kris decided the shape on 2026-10-15 at 15:40 (board #89): scheduling
> runs in parallel with Phase 3 billing; booking requires a punch card or a membership already in the skeleton; the
> waitlist promotes automatically. The defaults in section 15 apply unless Kris objects.
> **Audience:** Engineering, AI coding agents
> **Inputs:** `11_Scheduling_Engine.md`, `24_Development_Roadmap.md` sections 7 and 8, `26` (Phase 1), `27` (Phase 2),
> `28` (Phase 3 billing, draft #83), ADR-0021 ($0 fixed cost), the Studio mockup
> (`docs/design/mockups/studio-2026-10-13/`: Schedule, ClassDetail, AppBook, AppClass, AppBookings).
> **Decision policy:** as in docs/26. **Proposed** choices become **Decisions** when this document merges.

## 1. Scope

The roadmap's Phase 5 (first vertical walking skeleton), pulled forward because the first vertical is Studio
(decision of 2026-10-10) and a studio cannot try Tempo without a timetable. It takes from Phase 6 only the parts of
Scheduling and of studio products (passes) that the skeleton needs.

The demo this document must make possible, end to end on dev:

1. The owner creates rooms, class types and a weekly class; sessions appear for the next eight weeks.
2. The owner creates a punch-card product; staff grant a card to a member at the desk.
3. The member books from the phone; one entry is taken.
4. The class fills; the next member joins the waitlist.
5. Someone cancels inside the free window: the entry returns, the first waiting member is promoted, gets an entry
   taken and an in-app notification.
6. The instructor sees the roster and marks attendance.
7. Every step is in the studio's audit log.

In scope:

- rooms, class types, weekly templates and one-off sessions, materialized sessions on a rolling horizon;
- booking, cancellation, the free-cancellation window, the waitlist with automatic promotion;
- roster and attendance;
- pass products (punch card, period membership), passes granted by hand, an entry ledger;
- a booking policy per studio;
- a minimal in-app notification inbox (the delivery channels come in Phase 4);
- the hooks Phase 3 needs: entitlement limits and restricted mode on these routes.

Out of scope, and where it goes:

| Item | Where |
|---|---|
| Members paying for passes online (merchant payments) | Phase 6, after Phase 3's provider |
| Push and email delivery of notifications | Phase 4 (needs the domain and SES) |
| Appointments (1:1), staff availability, resource conflicts beyond rooms | Phase 6 Scheduling |
| External calendar sync (`11` section 7) | later; "add to calendar" in the app is an `.ics` download |
| Moving a booking to another session ("העברה לשיעור" in the mockup), messages to the registered | after the skeleton |
| Pausing a membership, family passes, pass transfer | after the skeleton |
| Multiple locations | the model has rooms only; `location` arrives with Phase 6 |

## 2. Constraints that shape this design

- **$0 fixed cost** (ADR-0021): no new paid resources. The daily horizon job rides the existing daily schedule.
- **Neon PostgreSQL 18** with RLS on every tenant table, as in docs/26 section 7.
- **Correct under concurrency.** Two members taking the last place at the same second is the normal case at 07:00
  on a Sunday, not an edge case. Overbooking and double-spending an entry must be impossible by construction.
- **Time:** UTC instants in the database; the studio's IANA time zone (`organizations.time_zone`) for everything a
  person sees and for recurrence; DST tested (`11` section 3).
- **People, not logins.** A booking belongs to a person record (docs/27 section 4), so staff can book a walk-in who
  has no app.

## 3. Model

| Concept | What it is |
|---|---|
| Room | A place in the studio with a default capacity ("חדר המכשירים", 8). |
| Class type | What is taught: name, category (pilates, yoga), color, default duration, description. |
| Template | A weekly rule: class type, weekday, local start time, duration, instructor, room, capacity, valid from and until. |
| Session | One occurrence on one date, with its own instructor, room and capacity. Created from a template or one-off. |
| Booking | A person's place in a session: `booked`, `waitlisted`, `cancelled`, `attended`, `no_show`, `removed`. |
| Pass product | What the studio sells: a punch card (N entries, valid D days) or a period membership (D days, unlimited or a weekly cap). |
| Pass | A product granted to one person, with start and end dates and, for a card, entries used. |
| Pass use | The ledger row that ties one booking to one pass: `held`, `returned`. |
| Booking policy | Per studio: free-cancellation window, waitlist cutoff, how far ahead booking opens. |
| Inbox item | An in-app notification for a person in a studio. |

```text
template ──materializes──▶ session ◀── booking ──▶ person
                                          │
                                          └── pass use ──▶ pass ──▶ pass product
```

## 4. Sessions and the timetable

### 4.1 Templates and materialization

**Proposed.**

- A template stores the weekday and the **local** start time with the studio's time zone, not a UTC instant, so a
  17:30 class stays at 17:30 across the DST change (`11` section 3).
- Materialization creates the template's sessions from today to **eight weeks** ahead. The key is
  `(template_id, local_date)`, unique, so running it twice changes nothing (`11` section 4).
- It runs in the request that creates or edits a template (at most 8 rows for a weekly rule, so synchronous is
  bounded), and once a day in the worker to extend the horizon by one day for every studio.
- **Editing a template** applies to future sessions of that template with no live bookings. Sessions that already
  have bookings keep their values; the response lists them so the console can offer to edit each one by hand.
- **Ending a template** (`valid_until`) removes its future sessions that have no live bookings and leaves the rest
  for the studio to cancel explicitly.
- A **one-off session** has no template.

### 4.2 Editing and cancelling one session

- Instructor, room and capacity can change on a single session. Capacity cannot go below the number booked
  (`session.capacity_below_booked`). Raising capacity promotes from the waitlist at once (section 6.3).
- **Cancelling a session** by the studio cancels every live booking and waitlist entry, returns every held entry
  regardless of the window, and puts an inbox item for each person. The session stays, with status `cancelled`.

### 4.3 What a member sees

`GET /sessions?from=&to=` returns sessions with `bookedCount`, `capacity`, `waitlistCount` and the caller's own
booking state, which is everything AppBook shows. Members see sessions from now until the booking horizon
(section 6.1); staff see any range up to 62 days per request.

## 5. Passes

### 5.1 Products

**Proposed.** Two kinds, enough for every studio in the mockup ("מנוי חודשי או כניסה אחת מכרטיסייה"):

| Kind | Fields |
|---|---|
| `punch_card` | `entries` (1 to 200), `valid_days` (1 to 730) |
| `membership` | `valid_days` (1 to 730), `weekly_cap` (null = unlimited, else 1 to 14) |

Both carry `name`, optional `class_category` (null = every class type; else only that category, so a "pilates
card" cannot book yoga), `price_agorot` (shown only; nothing charges it in the skeleton) and `status`
(`active`, `archived`). A product is never edited once a pass uses it: a change archives it and creates a new one,
so a granted pass always means what it meant when it was sold.

### 5.2 Granting

Staff with `passes.manage` grant a pass to a person: product, start date (default today), an optional note
("שולם במזומן"). The end date is the start plus `valid_days`. The grant is audited with ids only. A pass can be
**voided** (a mistake, a refund): held entries stay held for sessions already taken; no new booking uses it.

### 5.3 Which pass a booking uses

**Proposed.** When a booking needs an entry, the service picks one live pass of the person, in this order:

1. valid on the session's local date (`starts_on <= date <= ends_on`) and not voided;
2. allowed for the session's class category;
3. with room: a card with `entries_used < entries`, or a membership under its weekly cap for that week;
4. the one that **ends first**, memberships before cards when they end the same day, so the member never loses
   entries that would have expired.

No eligible pass: `409 booking.no_valid_pass`, and the app says what is missing ("אין כרטיסייה בתוקף לשיעור הזה").

### 5.4 The ledger

Every booking that holds a place holds exactly one `pass_uses` row, `held`. A cancellation inside the free window,
a cancellation by the studio, or a removal by staff marks it `returned`. A late cancellation and a no-show keep it
`held`: the entry is used.

For a card, `passes.entries_used` is a counter kept in the same transaction as the ledger row, guarded by
`entries_used < entries` in the `UPDATE`, so two bookings cannot spend the last entry twice. The ledger is the
source of truth and an integration test checks `entries_used = count(held uses)` after every scenario.

For a membership with a weekly cap, the week is Sunday to Saturday in the studio's time zone. The check counts the
pass's held uses on sessions in that week, under `SELECT ... FOR UPDATE` on the pass row.

## 6. Booking

### 6.1 Booking policy

Per studio, editable by `schedule.manage`:

| Setting | Default | Range |
|---|---|---|
| `free_cancel_hours` | 6 (section 15, C-1) | 0 to 72 |
| `waitlist_cutoff_hours` | 2 (Kris, 2026-10-15) | 0 to 24 |
| `booking_horizon_days` | 14 | 1 to 56 |
| `waitlist_enabled` | true | |

### 6.2 Booking a place

`POST /sessions/{id}/bookings` with no body books the caller (the "self" rule); with `{ personId }` it books someone
else and needs `bookings.manage`. In one transaction:

1. Lock nothing yet; read the session. Reject if `cancelled`, if it has started (`booking.closed`), if it is beyond
   the horizon for a self-booking (`booking.not_open`), or if the person already holds a live booking or waitlist
   place in it (`booking.duplicate`, enforced also by a partial unique index).
2. Pick the pass (section 5.3), locking it.
3. Take a place atomically:
   ```sql
   UPDATE scheduling.sessions SET booked_count = booked_count + 1, version = version + 1
   WHERE organization_id = $1 AND id = $2 AND status = 'scheduled' AND booked_count < capacity
   RETURNING booked_count;
   ```
   One row: insert the booking `booked` and the pass use `held` (and bump `entries_used` for a card).
   No row: the session is full.
4. Full, and the waitlist is enabled and the cutoff has not passed: insert the booking `waitlisted` with the next
   `waitlist_position` (from a per-session counter column, also atomic). **No entry is held while waiting**
   (C-2); step 2 only checked that the person has an eligible pass now. Full otherwise: `409 session.full`.

The response is the booking with its state, so the app shows "רשומה" or "מקום 2 בהמתנה".

### 6.3 Cancelling, and promotion

`POST /bookings/{id}/cancel` (self, or `bookings.manage`):

- `booked`: status `cancelled`, `booked_count - 1`. Inside the free window (`now <= starts_at - free_cancel_hours`)
  the pass use is `returned` (and `entries_used - 1`); outside it stays `held` and the booking is marked
  `late_cancel = true`. Staff can override to return the entry (`returnEntry: true`, `bookings.manage` only).
- `waitlisted`: status `cancelled`; positions behind it do not renumber (the order is by position, gaps are fine).

**Promotion** runs in the same transaction whenever a place frees up (a cancellation, a removal, a capacity raise),
as long as `now < starts_at - waitlist_cutoff_hours`:

1. Take the waitlisted bookings in position order, `FOR UPDATE SKIP LOCKED`.
2. For the first one, pick a pass now (section 5.3). Found: the booking becomes `booked`, the pass use is held,
   `booked_count + 1`, and an inbox item "נרשמת לשיעור" is created. Not found: that booking becomes `cancelled`
   with `reason = 'no_valid_pass'`, the person gets an inbox item saying why, and the next one is tried.
3. Past the cutoff, waiting bookings stay as they are and are closed by the worker when the session starts
   (`expired`, an inbox item "השיעור התחיל, לא התפנה מקום").

### 6.4 Roster and attendance

- `GET /sessions/{id}/roster`: booked and waitlisted people with name, pass name and booking time; for
  `bookings.manage`, or for the session's own instructor.
- `POST /bookings/{id}/attendance` with `attended` or `no_show`, from 30 minutes before the start until 7 days after;
  `attendance.mark`, or the session's own instructor. A no-show keeps the entry used.
- An unmarked booking after the session ends counts as attended for history and stays `booked` in the data (C-3).

## 7. Database

Migration `0010_scheduling.sql` (0009 is billing in docs/28). Same conventions as docs/26 section 7 and docs/27
section 5: UUID v7, `timestamptz`, `version` on mutable rows, tenant-leading primary keys, composite foreign keys,
RLS enabled with the tenant clause on every table.

```sql
CREATE SCHEMA scheduling;

CREATE TABLE scheduling.booking_policies (
    organization_id        uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    free_cancel_hours      int NOT NULL DEFAULT 6 CHECK (free_cancel_hours BETWEEN 0 AND 72),
    waitlist_cutoff_hours  int NOT NULL DEFAULT 2 CHECK (waitlist_cutoff_hours BETWEEN 0 AND 24),
    booking_horizon_days   int NOT NULL DEFAULT 14 CHECK (booking_horizon_days BETWEEN 1 AND 56),
    waitlist_enabled       boolean NOT NULL DEFAULT true,
    updated_at             timestamptz NOT NULL,
    version                bigint NOT NULL DEFAULT 0
);

CREATE TABLE scheduling.rooms (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    default_capacity int NOT NULL CHECK (default_capacity BETWEEN 1 AND 500),
    status           text NOT NULL CHECK (status IN ('active', 'archived')),
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);

CREATE TABLE scheduling.class_types (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    category         text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,29}$'),
    color            text NOT NULL,          -- a design-system class color key: sage, rose, taupe, amber, mauve, blue
    default_minutes  int NOT NULL CHECK (default_minutes BETWEEN 10 AND 300),
    description      text,
    status           text NOT NULL CHECK (status IN ('active', 'archived')),
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);

CREATE TABLE scheduling.templates (
    organization_id         uuid NOT NULL,
    id                      uuid NOT NULL,
    class_type_id           uuid NOT NULL,
    weekday                 smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
    local_start             time NOT NULL,
    minutes                 int NOT NULL CHECK (minutes BETWEEN 10 AND 300),
    instructor_membership_id uuid,
    room_id                 uuid,
    capacity                int NOT NULL CHECK (capacity BETWEEN 1 AND 500),
    valid_from              date NOT NULL,
    valid_until             date,
    materialized_until      date,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, class_type_id) REFERENCES scheduling.class_types (organization_id, id),
    FOREIGN KEY (organization_id, room_id) REFERENCES scheduling.rooms (organization_id, id),
    FOREIGN KEY (organization_id, instructor_membership_id) REFERENCES organizations.memberships (organization_id, id),
    CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

CREATE TABLE scheduling.sessions (
    organization_id         uuid NOT NULL,
    id                      uuid NOT NULL,
    template_id             uuid,
    local_date              date NOT NULL,
    class_type_id           uuid NOT NULL,
    starts_at               timestamptz NOT NULL,
    ends_at                 timestamptz NOT NULL,
    instructor_membership_id uuid,
    room_id                 uuid,
    capacity                int NOT NULL CHECK (capacity BETWEEN 1 AND 500),
    booked_count            int NOT NULL DEFAULT 0,
    next_waitlist_position  int NOT NULL DEFAULT 1,
    status                  text NOT NULL CHECK (status IN ('scheduled', 'cancelled')),
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, template_id) REFERENCES scheduling.templates (organization_id, id),
    FOREIGN KEY (organization_id, class_type_id) REFERENCES scheduling.class_types (organization_id, id),
    CHECK (ends_at > starts_at),
    CHECK (booked_count BETWEEN 0 AND capacity)
);
CREATE UNIQUE INDEX ux_sessions_occurrence ON scheduling.sessions (organization_id, template_id, local_date)
    WHERE template_id IS NOT NULL;
CREATE INDEX ix_sessions_time ON scheduling.sessions (organization_id, starts_at);

CREATE TABLE scheduling.pass_products (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    kind             text NOT NULL CHECK (kind IN ('punch_card', 'membership')),
    name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    entries          int CHECK (entries BETWEEN 1 AND 200),
    valid_days       int NOT NULL CHECK (valid_days BETWEEN 1 AND 730),
    weekly_cap       int CHECK (weekly_cap BETWEEN 1 AND 14),
    class_category   text,
    price_agorot     int CHECK (price_agorot >= 0),
    status           text NOT NULL CHECK (status IN ('active', 'archived')),
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    CHECK ((kind = 'punch_card' AND entries IS NOT NULL AND weekly_cap IS NULL)
        OR (kind = 'membership' AND entries IS NULL))
);

CREATE TABLE scheduling.passes (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    person_id        uuid NOT NULL,
    product_id       uuid NOT NULL,
    starts_on        date NOT NULL,
    ends_on          date NOT NULL,
    entries          int,                       -- copied from the product for a card
    entries_used     int NOT NULL DEFAULT 0,
    note             text CHECK (length(note) <= 200),   -- "שולם במזומן"; erased with the person
    status           text NOT NULL CHECK (status IN ('active', 'voided')),
    granted_by       uuid NOT NULL,             -- membership
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, product_id) REFERENCES scheduling.pass_products (organization_id, id),
    CHECK (ends_on >= starts_on),
    CHECK (entries IS NULL OR entries_used BETWEEN 0 AND entries)
);
CREATE INDEX ix_passes_person ON scheduling.passes (organization_id, person_id, ends_on);

CREATE TABLE scheduling.bookings (
    organization_id    uuid NOT NULL,
    id                 uuid NOT NULL,
    session_id         uuid NOT NULL,
    person_id          uuid NOT NULL,
    status             text NOT NULL CHECK (status IN ('booked', 'waitlisted', 'cancelled', 'attended', 'no_show', 'removed', 'expired')),
    waitlist_position  int,
    late_cancel        boolean NOT NULL DEFAULT false,
    cancel_reason      text CHECK (cancel_reason IN ('self', 'staff', 'session_cancelled', 'no_valid_pass')),
    booked_by          uuid NOT NULL,           -- membership that made the booking
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, session_id) REFERENCES scheduling.sessions (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE UNIQUE INDEX ux_bookings_one_live ON scheduling.bookings (organization_id, session_id, person_id)
    WHERE status IN ('booked', 'waitlisted', 'attended', 'no_show');
CREATE INDEX ix_bookings_waitlist ON scheduling.bookings (organization_id, session_id, waitlist_position)
    WHERE status = 'waitlisted';
CREATE INDEX ix_bookings_person ON scheduling.bookings (organization_id, person_id, created_at);

CREATE TABLE scheduling.pass_uses (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    pass_id          uuid NOT NULL,
    booking_id       uuid NOT NULL,
    status           text NOT NULL CHECK (status IN ('held', 'returned')),
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, pass_id) REFERENCES scheduling.passes (organization_id, id),
    FOREIGN KEY (organization_id, booking_id) REFERENCES scheduling.bookings (organization_id, id)
);
CREATE UNIQUE INDEX ux_pass_uses_one_per_booking ON scheduling.pass_uses (organization_id, booking_id);

CREATE SCHEMA notifications;
CREATE TABLE notifications.inbox_items (
    organization_id  uuid NOT NULL,
    id               uuid NOT NULL,
    person_id        uuid NOT NULL,
    kind             text NOT NULL,             -- booking.promoted, booking.promotion_failed, session.cancelled, waitlist.expired
    data             jsonb NOT NULL,            -- ids only (session, booking), never names
    read_at          timestamptz,
    created_at       timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE INDEX ix_inbox_person ON notifications.inbox_items (organization_id, person_id, created_at DESC);
```

- Data migration: every existing studio gets a `booking_policies` row with the defaults; new studios get one in
  `OrganizationService.CreateAsync`.
- Erasure (docs/27 section 4.7): bookings, passes and inbox items keep their ids and point at the anonymized person;
  the only free text is `passes.note`, which erase clears. Export adds the person's bookings and passes.
- Merge (docs/27 section 4.6): bookings, passes and inbox items move to the survivor; a session where both records
  hold a live booking keeps the survivor's and cancels the other with its entry returned.

## 8. Permissions

New catalog keys (docs/27 section 3.1), seeded into the system roles by the migration:

| Key | What it allows | owner | admin | staff | client |
|---|---|---|---|---|---|
| `schedule.view` | See the timetable | yes | yes | yes | yes |
| `schedule.manage` | Rooms, class types, templates, one-off sessions, the booking policy, cancel or edit a session | yes | yes | | |
| `bookings.manage` | Book or cancel for others, return an entry on a late cancel, read any roster | yes | yes | yes | |
| `attendance.mark` | Mark attendance on any session | yes | yes | yes | |
| `passes.view` | See products and anyone's passes | yes | yes | yes | |
| `passes.manage` | Create and archive products, grant and void passes | yes | yes | | |

Resource rules: **self** (book, cancel and read one's own bookings and passes, with `schedule.view`) and
**instructor** (the session's own instructor reads its roster and marks its attendance without
`bookings.manage` or `attendance.mark`).

## 9. API

Tenant routes under `/api/v1/organizations/{organizationId}`.

| Method and path | Permission |
|---|---|
| `GET /rooms`, `POST /rooms`, `PATCH /rooms/{roomId}` | `schedule.view` / `schedule.manage` |
| `GET /class-types`, `POST /class-types`, `PATCH /class-types/{classTypeId}` | `schedule.view` / `schedule.manage` |
| `GET /schedule-templates`, `POST /schedule-templates`, `PATCH /schedule-templates/{templateId}` | `schedule.manage` |
| `GET /sessions?from=&to=&classTypeId=&instructorMembershipId=` | `schedule.view` |
| `POST /sessions` (one-off), `PATCH /sessions/{sessionId}`, `POST /sessions/{sessionId}/cancel` | `schedule.manage` |
| `GET /sessions/{sessionId}` | `schedule.view` |
| `GET /sessions/{sessionId}/roster` | `bookings.manage` or instructor |
| `POST /sessions/{sessionId}/bookings` (`{ personId? }`) | self, or `bookings.manage` |
| `POST /bookings/{bookingId}/cancel` (`{ returnEntry? }`) | self, or `bookings.manage` |
| `POST /bookings/{bookingId}/attendance` (`{ state }`) | `attendance.mark` or instructor |
| `GET /me/bookings?scope=upcoming\|past&before=&limit=` | self |
| `GET /me/passes` | self |
| `GET /me/notifications`, `POST /me/notifications/{itemId}/read` | self |
| `GET /pass-products`, `POST /pass-products`, `POST /pass-products/{productId}/archive` | `passes.view` / `passes.manage` |
| `GET /people/{personId}/passes`, `POST /people/{personId}/passes`, `POST /passes/{passId}/void` | `passes.view` / `passes.manage` |
| `GET /people/{personId}/bookings` | `bookings.manage` |
| `GET /booking-policy`, `PUT /booking-policy` | `schedule.view` / `schedule.manage` |

New error codes: `session.not_found`, `session.full`, `session.cancelled`, `session.capacity_below_booked`,
`booking.not_found`, `booking.duplicate`, `booking.closed`, `booking.not_open`, `booking.no_valid_pass`,
`booking.not_cancellable`, `attendance.out_of_window`, `template.invalid`, `pass.not_found`, `pass.voided`,
`pass_product.in_use`. Restricted mode (docs/28) answers `402 billing.restricted` on every `POST`/`PATCH`/`PUT` here
except `POST /bookings/{id}/cancel` (B-8: members may still cancel).

The contract for this section (contract-v3) is the first PR after this LLD, together with docs/28 section 8.

## 10. Audit

New actions: `room.created`, `room.updated`, `class_type.created`, `class_type.updated`, `template.created`,
`template.updated`, `session.created`, `session.updated`, `session.cancelled`, `booking.created`,
`booking.waitlisted`, `booking.promoted`, `booking.cancelled`, `booking.attendance_marked`, `pass_product.created`,
`pass_product.archived`, `pass.granted`, `pass.voided`, `booking_policy.updated`. Data holds ids, states and
numbers only (docs/27 section 7).

## 11. Worker and infrastructure

- One new message type, `scheduling.daily`: extend every studio's horizon by one day; close waitlists of sessions
  that have started. Idempotent; safe to run twice.
- It is sent by a second EventBridge Scheduler schedule next to the tripwire's (`messaging-stack.ts`,
  docs/26 section 10.2), because each schedule sets one `MessageType`. Waitlists close only once a day this way,
  so the API also treats a waitlisted booking of a started session as expired when it reads it.
- No paid resource (a daily schedule is inside EventBridge Scheduler's free tier), no new SSM parameter, $0.

## 12. Apps

- **Console (admin-web):** weekly timetable (Schedule mockup) with a "new class" dialog that creates a template or
  a one-off; class detail with roster, waitlist, attendance and cancel (ClassDetail); settings for rooms, class
  types, pass products and the booking policy; "passes" on the person card with grant and void.
- **Member app (client-web):** AppBook on `GET /sessions`, the booking sheet ("כלול במנוי החודשי שלך" from the pass
  the server would pick, returned as `passPreview` on the session for the caller), AppClass with cancel and the
  free-cancel time, AppBookings (upcoming and history), passes and remaining entries on the profile, the inbox.
- **Instructor:** the class detail screen fits a phone first.

## 13. Tests

- **Unit:** pass selection order; weekly-cap week boundaries in `Asia/Jerusalem`; free-window arithmetic;
  materialization keys and DST (the last Friday of March and the last Sunday of October 2026).
- **Integration (PostgreSQL 18):** RLS on every new table; **concurrency**: 20 parallel bookings for 8 places give
  exactly 8 `booked` and 12 `waitlisted`; 5 parallel bookings on a card with 1 entry left spend it once;
  `entries_used = count(held uses)` after every scenario; promotion skips a waiter with no valid pass; template edit
  leaves booked sessions untouched; materialization twice is a no-op.
- **API flow:** the demo in section 1 through the real host, as the Phase 1 and Phase 2 flow tests.

## 14. Delivery plan

One PR each, in order, chained where they depend on each other:

1. This LLD.
2. contract-v3: section 9 and docs/28 section 8 (SYNC 1 on board #89: both agents approve, the client is
   regenerated).
3. Migration 0010 with the policy backfill, permissions seeded into the system roles, RLS integration tests.
4. Rooms, class types, templates, one-off sessions, materialization (sync and the daily job).
5. Pass products, grant and void, `GET /me/passes`.
6. Booking and cancellation with pass consumption, the concurrency tests.
7. Waitlist, promotion and the inbox.
8. Roster and attendance, session edit and cancel.
9. The end-to-end flow test (SYNC 2).

## 15. Open questions for Kris

| Id | Question | Default if nobody objects |
|---|---|---|
| C-1 | Free-cancellation window | Studio setting, default 6 hours (board #89). The mockup says 4 hours; either is one setting away. |
| C-2 | Does a waitlist place hold an entry? | No. Eligibility is checked when joining; the entry is taken on promotion. A waiter with no valid pass at that moment is skipped and told why. |
| C-3 | A booking nobody marked after the class | Counts as attended (the entry is used either way). |
| C-4 | How far ahead members can book | 14 days, studio setting. |
| C-5 | The week for a membership's weekly cap | Sunday to Saturday, studio time zone. |
| C-6 | When a punch card's validity starts | On the grant date (staff can set another start date). |
| C-7 | Can an instructor see rosters of other classes? | No: their own sessions only, unless their role has `bookings.manage` (staff does by default). |
| C-8 | A studio cancels a class | Every entry returns, waiters are removed, everyone gets an inbox item. |

## 16. After the skeleton: moves, messages, calendar files, freezes

Added on the night of 2026-10-15 (board #136, lane K-A, items A2 to A5). Each is one PR, in this order, after A1
(the contract gaps the console screens found). Everything here keeps the rules above: ids only in audit, the
tenant filter on every statement, guarded updates for places and entries, no new paid resource.

### 16.1 Moving a booking to another class (A2)

Staff with `bookings.manage` move a `booked` place to another session of the same studio:
`POST /bookings/{bookingId}/move` with `{ sessionId }`, answer 200 with the **new** `Booking`.

- The target must be `scheduled`, not started, and have a free place. A full target answers 409 `session.full`:
  a move never joins a waitlist (staff can cancel and let the member join the line themselves).
- The entry moves with the place: inside one transaction the held entry is returned and held again for the new
  class (the ledger shows one `returned` and one `held` use), so once it commits nothing is
  returned or spent. The pass must still cover the target (category, validity, weekly cap in the target's week);
  otherwise 409 `booking.no_valid_pass` and nothing changes.
- The old row becomes `cancelled` with the new `cancelReason` value `moved` (never a late cancel), the old session's
  `booked_count` drops by one and its waitlist is promoted as after any cancellation (section 6.3). Both sessions are
  locked `FOR UPDATE` in id order inside one transaction, so two staff moving into the last place cannot overbook.
- Audit: `booking.moved` on the new booking with `{ fromSessionId, toSessionId, previousBookingId }`. The member gets
  an inbox item of kind `booking_moved` with the new session.
- A member cannot move their own booking in this step (C-9).

### 16.2 A message to everyone registered (A3)

Staff with `bookings.manage`, or the session's instructor (section 6.4), send one short text to a class:
`POST /sessions/{sessionId}/messages` with `{ text }` (1 to 500 characters after trimming), answer 202 with
`{ recipients }`.

- Recipients are everyone with a live place: `booked` and `waitlisted` (a room change matters to the line too).
  Each gets an inbox item of kind `session.message` that carries the text (`InboxItem.text`) and the session summary. No push, SMS or
  email in this step: delivery channels are docs/30.
- Audit: `session.message_sent` with `{ sessionId, recipients }` only. The text is never in the audit log; the
  inbox item is its only copy, and erasing a person deletes their inbox items of this kind.
- At most 5 messages per session per hour (409 `session.message_limit`), so a stuck button cannot flood a class.
- A session that is `cancelled` or ended more than a day ago answers 409 `booking.closed`.

### 16.3 Add to calendar (A4)

`GET /me/bookings/{bookingId}/calendar.ics` (self; the booking must be `booked` or `attended`, otherwise 404)
returns `text/calendar; charset=utf-8` with one `VEVENT`:

- `UID` = `{bookingId}@tempo`, `DTSTAMP` now, `DTSTART`/`DTEND` in UTC (`Z`), `SUMMARY` = the class name,
  `LOCATION` = studio name plus the room when set, `DESCRIPTION` = one Hebrew line with the instructor's first name
  when set. `METHOD:PUBLISH`, `PRODID` = Tempo. No other person's data.
- Lines are folded at 75 octets with CRLF, and commas, semicolons and backslashes are escaped (RFC 5545). The
  apps open it with `Content-Disposition: attachment; filename="tempo-{localDate}.ics"`.
- Cancelling the booking does not update the calendar entry (no `METHOD:CANCEL` without email, docs/30).

### 16.4 Freezing a membership (A5)

Staff with `passes.manage` freeze a period membership (`kind = membership`) for a date range:
`POST /passes/{passId}/freezes` with `{ startsOn, endsOn }` (studio dates, inclusive, at most 90 days, the start no
earlier than today), answer 201 with the `Pass` carrying its `freezes`. `DELETE /passes/{passId}/freezes/{freezeId}`
removes a freeze that has not started yet.

- Migration 0012 adds `scheduling.pass_freezes (organization_id, id, pass_id, starts_on, ends_on, created_by,
  created_at)` with RLS, and `passes.ends_on` is extended by the frozen days when the freeze is created (and
  shortened back on delete). `endsOn` stays the single truth for validity, so `GET /me/passes` and section 5.3 keep
  working without a new rule.
- While frozen, pass selection (section 5.3) skips the membership; a member whose only pass is frozen gets 409
  `booking.no_valid_pass` with the freeze dates in the Problem. Bookings already made inside the frozen period are
  kept (C-11).
- Punch cards are not frozen in this step (C-12). Overlapping freezes on one pass answer 409 `pass.freeze_overlap`.
- Audit: `pass.frozen` and `pass.unfrozen` with `{ passId, startsOn, endsOn, days }`. The member gets an inbox item
  `pass_frozen`.

### 16.5 Open questions for Kris (added by this section)

| Id | Question | Default if nobody objects |
|---|---|---|
| C-9 | May a member move their own booking from the app? | Not yet. Staff only; the member cancels and books again (the free window applies). |
| C-10 | Does a class message reach the waitlist? | Yes, both `booked` and `waitlisted`. |
| C-11 | A membership frozen over a period with bookings already made | The bookings stay; the freeze only blocks new ones. |
| C-12 | Freezing a punch card | No. Its validity (`validDays`) is the lever; staff can grant a new card. |
| C-13 | How many freezes per membership | No cap, 90 days each at most; the console shows the total frozen days. |

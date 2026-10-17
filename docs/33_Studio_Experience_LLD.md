# Studio Experience LLD (premium redesign capabilities)

> **Status:** Decision (Kris, 2026-10-17: "הדיזיין החדש מצוין", approve the capabilities and the redesign; storage on
> S3, check-in code in the app now and phone wallets later, buddies only by mutual consent). D16 to D19 in
> `docs/claude-memory/decisions.md`.
> **Audience:** Kris, Ofir, the agents.
> **Inputs:** the premium mockups (`docs/design/mockups/premium-2026-10-17/`, canvas
> https://claude.ai/artifact/NUG1JaZVkZfPixXyeBTnNK), `25_Design_System.md` (the eight principles), `29` (scheduling,
> passes), `27` (people, permissions, erase), `32` (reports), `15` (file storage), ADR-0001 (AWS only), ADR-0021
> ($0 until revenue).

The premium mockups show things a member and an owner can do that Tempo cannot do yet. A redesign that draws a
reformer map, an instructor's playlist or a check-in code without the data behind them would be a lie. This document
lists every capability the mockups show, says which exist, and designs the missing ones end to end: data, API,
permissions, audit, privacy, apps and tests.

## 1. Capability matrix

Every capability visible on the four screens of the canvas, and its state on 2026-10-17 (main `756f6a1`).

| # | Capability (screen) | State before | Where |
|---|---|---|---|
| C1 | Next class with countdown, instructor, room (member home) | exists | `GET /me/bookings` |
| C2 | Week strip and the day's classes with places left (member home) | exists | `GET /sessions` |
| C3 | Pace: visits this month, streak, goal (member home) | partial: no week-by-week history | `GET /me/progress`, section 9 |
| C4 | Pass card with entries left and validity (member home) | exists | `GET /me/passes` |
| C5 | Add to calendar (booking done) | exists | `calendar.ics` (docs/29 16.3) |
| C6 | **Pick a reformer on a room map**, taken places, the room's window, mirror and instructor (booking) | missing | section 3 |
| C7 | **The usual spot** (booking) | missing | section 3.5 |
| C8 | **A buddy's spot** on the map, by mutual consent (booking) | missing | section 4 |
| C9 | **Instructor profile**: photo, bio, Instagram, playlist (booking, home) | missing | section 5 |
| C10 | **Pictures**: class covers, instructor photos, studio cover, member avatar | missing (no file storage) | section 6 |
| C11 | **Instructor note on a class** ("להביא גרביים נגד החלקה") (home) | missing | section 7 |
| C12 | **Check-in code** in the app, scanned at the door; check-in opens before class (home, booking done, live) | missing (attendance is marked by hand) | section 8 |
| C13 | Wallet pass (Apple, Google) | out of scope now (D19) | later, after revenue |
| C14 | Live class: who came, by spot, mark arrival by tapping the spot (owner phone) | partial: roster and attendance exist, no spots | sections 3, 8 |
| C15 | Spot out of service ("בתחזוקה") (owner phone) | missing | section 3.2 |
| C16 | Waitlist promotion into a freed spot, with notice (owner phone) | partial: promotion exists, no spot | section 3.4 |
| C17 | Passes ending soon, members at risk (owner) | exists | docs/32 section 6 |
| C18 | **Sales this month and a forecast** (owner) | missing | section 9.1 |
| C19 | **Occupancy heatmap** of the week (owner) | missing | section 9.2 |
| C20 | **Full class with a long waitlist: suggestion to open another** (owner) | missing | section 9.3 |
| C21 | **What happens now**: live activity feed (owner) | missing (audit has ids only) | section 9.4 |
| C22 | **Search anything** (Ctrl K) (owner) | partial: people search only | section 9.5 |
| C23 | Personal message to members at risk, renewal offer to passes ending (owner) | partial: messages to a class exist | section 9.6 |
| C24 | Health declaration missing, flagged on the spot (owner phone) | exists | docs/31 |
| C25 | Slide to book, glass, motion (booking) | presentation only | `25_Design_System.md` |

## 2. Decisions

| Id | Decision |
|---|---|
| X-1 | Spot selection is a per-room setting. A room without a layout books as today (a place, no spot). |
| X-2 | A spot is held by the booking, not by the person: cancelling frees it; moving keeps no spot. |
| X-3 | If the member doesn't pick, the server assigns the usual spot if free, else the first free spot by layout order. |
| X-4 | Other members' spots are shown as "taken" with no name or picture. Only a buddy (section 4) is named. Staff see everyone. |
| X-5 | Buddies are mutual and symmetric: one shares a one-time code, the other enters it; either side ends it at any time. No search, no list of members, no requests. |
| X-6 | An instructor profile is public inside the studio (every member sees it). Links are validated: Instagram handle only, playlist URL only from `open.spotify.com`, `music.apple.com` or `music.youtube.com`. |
| X-7 | Pictures live in one private S3 bucket per environment (D17). Every picture is decoded and re-encoded on the server (WebP, two sizes, metadata stripped); the original is deleted. Re-encoding replaces a malware scan for images. |
| X-8 | The check-in code is a rotating code (30 seconds) computed from a per-person secret, shown as a QR in the app. Staff scan it; check-in is allowed from 30 minutes before the start until the end (same window as attendance). |
| X-9 | Sales figures are pass grants at the product's list price (no payments yet), labelled "מכירות" and never "הכנסות". |
| X-10 | Insights are computed live under RLS, like docs/32 R-5: no table, no job. |
| X-11 | The activity feed shows the last 48 hours from domain tables, names included, behind `reports.view` and `people.view`. It is not the audit log. |

## 3. Rooms with spots (C6, C7, C14, C15, C16)

### 3.1 Model

A room gets an optional **layout**: a grid of rows and columns, the side the window is on, whether there is a mirror
wall at the front, and where the instructor stands. Each **spot** has a label ("6"), a cell (row, column), a kind
(`reformer`, `mat`, `bike`, `tower`, `chair`, `place`) and a status (`active`, `maintenance`, `archived`).

### 3.2 Database (migration 0024)

```sql
ALTER TABLE scheduling.rooms
    ADD COLUMN spot_selection boolean NOT NULL DEFAULT false,
    ADD COLUMN layout_rows    smallint CHECK (layout_rows BETWEEN 1 AND 12),
    ADD COLUMN layout_cols    smallint CHECK (layout_cols BETWEEN 1 AND 12),
    ADD COLUMN window_side    text CHECK (window_side IN ('start', 'end', 'back')),
    ADD COLUMN mirror_front   boolean NOT NULL DEFAULT false;

CREATE TABLE scheduling.room_spots (
    organization_id uuid NOT NULL,
    room_id         uuid NOT NULL,
    id              uuid NOT NULL,
    label           text NOT NULL CHECK (length(label) BETWEEN 1 AND 8),
    row_index       smallint NOT NULL CHECK (row_index BETWEEN 0 AND 11),
    col_index       smallint NOT NULL CHECK (col_index BETWEEN 0 AND 11),
    kind            text NOT NULL CHECK (kind IN ('reformer', 'mat', 'bike', 'tower', 'chair', 'place')),
    status          text NOT NULL CHECK (status IN ('active', 'maintenance', 'archived')),
    created_at, updated_at, version,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, room_id) REFERENCES scheduling.rooms (organization_id, id)
);
CREATE UNIQUE INDEX ux_room_spots_cell ON scheduling.room_spots (organization_id, room_id, row_index, col_index)
    WHERE status <> 'archived';
CREATE UNIQUE INDEX ux_room_spots_label ON scheduling.room_spots (organization_id, room_id, lower(label))
    WHERE status <> 'archived';

ALTER TABLE scheduling.bookings ADD COLUMN spot_id uuid;
ALTER TABLE scheduling.bookings ADD FOREIGN KEY (organization_id, spot_id) REFERENCES scheduling.room_spots (organization_id, id);
-- One live booking per spot per session; this index is what makes a double pick impossible.
CREATE UNIQUE INDEX ux_bookings_session_spot ON scheduling.bookings (organization_id, session_id, spot_id)
    WHERE spot_id IS NOT NULL AND status IN ('booked', 'attended', 'no_show');

CREATE TABLE scheduling.spot_preferences (
    organization_id uuid NOT NULL,
    person_id       uuid NOT NULL,
    room_id         uuid NOT NULL,
    spot_id         uuid NOT NULL,
    updated_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id, room_id)
);
```

RLS `_app` policy `organization_id = current_setting('app.organization_id')` on both new tables, as everywhere.
Rule: when `spot_selection` is on, the session's capacity can't exceed the room's active spots; saving the layout
with fewer active spots than a future session's `booked_count` is `409 room.spots_below_booked`.

### 3.3 Booking with a spot

`POST /sessions/{id}/bookings` takes an optional `spotId`. Inside the existing transaction (docs/29 6.2), after the
place is taken:

1. Room without spot selection: `spotId` must be absent (`400 booking.spot_not_offered`).
2. `spotId` given: it must belong to the session's room and be `active`, else `409 booking.spot_unavailable`.
3. No `spotId`: X-3, the usual spot if free, else the first free spot by row then column. The candidate list is read
   with the session row already locked by the `booked_count` update, so two bookings of the same session serialize.
4. Insert with `spot_id`; a unique violation on `ux_bookings_session_spot` (a staff move racing a member) maps to
   `409 booking.spot_unavailable`, and the transaction rolls back including the place and the entry.

`PUT /bookings/{id}/spot` (`{ spotId }`) changes the spot of a live booking: the member for their own booking until
the session starts, staff (`bookings.manage`) any time including swaps. Promotion from the waitlist (docs/29 6.3)
assigns a spot by X-3. A waitlisted booking has no spot.

`PUT /me/spot-preferences/{roomId}` (`{ spotId | null }`) sets the usual spot; booking a spot does not change it
automatically, but the booking sheet offers "לשמור כמקום הקבוע".

### 3.4 What each side sees

`GET /sessions/{id}/spots` returns the room layout and one entry per active or maintenance spot: `id`, `label`, cell,
`kind`, `state` (`free`, `taken`, `mine`, `buddy`, `maintenance`), and for `buddy` the buddy's display name and
avatar. For a caller with `bookings.manage` or the session's instructor the endpoint adds `personId`,
`displayName`, avatar, `attendance` and `healthDeclarationMissing` for every taken spot (the live class screen).
Members never receive another member's id or name except a buddy's (X-4).

### 3.5 Console

Rooms page: an editor for the grid (rows, columns, tap a cell to add or remove a spot, label, kind, maintenance),
the window side and the mirror. The live class screen (owner phone mockup) uses the same map with attendance.

## 4. Buddies (C8)

### 4.1 Database (migration 0025)

```sql
CREATE TABLE people.buddy_codes (
    organization_id uuid NOT NULL,
    person_id       uuid NOT NULL,
    code_hash       bytea NOT NULL,           -- SHA-256 of the 8-character code; the code itself is never stored
    expires_at      timestamptz NOT NULL,     -- 48 hours
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_id)
);
CREATE TABLE people.buddy_links (
    organization_id uuid NOT NULL,
    person_low      uuid NOT NULL,            -- the smaller id, so one pair is one row
    person_high     uuid NOT NULL,
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, person_low, person_high),
    CHECK (person_low < person_high)
);
```

### 4.2 Flow and rules

- `POST /me/buddy-code` creates or replaces the caller's code (8 characters from a 31-character alphabet without
  look-alikes, shown once with a share button). `POST /me/buddies` with `{ code }` links the caller to the code's
  owner and deletes the code (one use). `GET /me/buddies` lists the caller's buddies; `DELETE /me/buddies/{personId}`
  ends a link from either side.
- At most 20 buddies per person. Five wrong codes in an hour lock the endpoint for that person for an hour
  (`429 buddy.too_many_attempts`), reusing the join-attempts pattern of migration 0003.
- Erasing a person (docs/27) deletes their codes and links. Export includes the buddies' display names.
- Audit: `buddy.linked`, `buddy.unlinked` with the two person ids, no code.

## 5. Instructor profiles (C9)

### 5.1 Database (migration 0026)

```sql
CREATE TABLE organizations.staff_profiles (
    organization_id  uuid NOT NULL,
    membership_id    uuid NOT NULL,
    headline         text CHECK (length(headline) <= 80),        -- "מורה לפילאטיס מכשירים"
    bio              text CHECK (length(bio) <= 600),
    instagram_handle text CHECK (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
    playlist_url     text CHECK (length(playlist_url) <= 300),
    photo_media_id   uuid,
    visible          boolean NOT NULL DEFAULT true,
    updated_at       timestamptz NOT NULL,
    version          bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, membership_id),
    FOREIGN KEY (organization_id, membership_id) REFERENCES organizations.memberships (organization_id, id)
);
```

The API checks `playlist_url` against X-6 (scheme `https`, host in the allowlist) and stores the handle without `@`.

### 5.2 API

- `GET /instructors` (`schedule.view`): visible profiles of active staff memberships who teach (have a template or
  a future session), with display name, headline, photo URL, Instagram handle and playlist URL.
- `GET /instructors/{membershipId}`: one profile with the next 5 sessions.
- `PUT /me/staff-profile`: a staff member edits their own profile. `PUT /instructors/{membershipId}/profile`:
  `schedule.manage` edits anyone's.
- `GET /sessions` and `GET /sessions/{id}` carry `instructor { membershipId, displayName, photoUrl }` so the list
  rows and the booking header show the face without a second call.

## 6. Pictures (C10)

### 6.1 Infrastructure

A new `TempoDev/Storage` stack (and prod later): one S3 bucket `tempo-<env>-media-<account>`, private, Block Public
Access on, SSE-S3, versioning off, `enforceSSL`, lifecycle: abort incomplete uploads after 1 day, expire `incoming/`
objects after 1 day. CORS allows `PUT` from the two app origins (Pages and localhost). The API Lambda gets
`s3:PutObject` on `incoming/*` (to presign), `s3:GetObject`/`s3:DeleteObject` on `incoming/*` and `s3:PutObject`/
`s3:GetObject`/`s3:DeleteObject` on `media/*`. No CloudFront (AWS refused it for the account on 2026-10-17), so images are
served with presigned GET URLs that live 6 hours and are cached by the browser.

**Cost (D17):** S3 Standard at pilot size (1 GB, 200 000 GETs and 5 000 PUTs a month) is about US$0.10 a month;
the first 100 GB of transfer out each month are free. Owner approved S3 on 2026-10-17. The fixed-cost guard is not
affected (no fixed-price resource).

### 6.2 Database (migration 0026)

```sql
CREATE TABLE media.media_objects (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    purpose         text NOT NULL CHECK (purpose IN ('class_cover', 'instructor_photo', 'studio_cover', 'avatar')),
    owner_type      text NOT NULL CHECK (owner_type IN ('class_type', 'membership', 'organization', 'person')),
    owner_id        uuid NOT NULL,
    status          text NOT NULL CHECK (status IN ('pending', 'ready', 'rejected', 'deleted')),
    media_type      text NOT NULL CHECK (media_type = 'image/webp'),
    width           int, height int, bytes int,
    object_key      text NOT NULL,           -- media/<org>/<id>/(large|small).webp
    created_by      uuid NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id)
);
ALTER TABLE scheduling.class_types       ADD COLUMN cover_media_id  uuid;
ALTER TABLE organizations.organizations  ADD COLUMN cover_media_id  uuid;
ALTER TABLE people.people                ADD COLUMN avatar_media_id uuid;
```

### 6.3 Upload flow (docs/15 section 3, for images)

1. `POST /media/uploads` with `{ purpose, ownerId, contentType, bytes }`: checks the permission for the owner
   (class cover: `schedule.manage`; studio cover: `organization.settings.manage`; instructor photo: self or
   `schedule.manage`; avatar: self or `people.manage`), type in `image/jpeg|png|webp`, size up to 8 MB; inserts a
   `pending` row and returns a presigned `PUT` for `incoming/<org>/<id>` that lives 10 minutes.
2. The app uploads directly to S3.
3. `POST /media/uploads/{id}/finalize`: the API reads the object, checks the magic bytes, decodes it (SkiaSharp,
   MIT; decode errors reject), rejects anything over 40 megapixels, re-encodes to WebP at 1600 and 400 pixels on the
   long side with no metadata, writes `media/<org>/<id>/large.webp` and `small.webp`, deletes the incoming object,
   marks the row `ready` and points the owner at it (the previous picture becomes `deleted` and its objects are
   removed).
4. Reads: payloads carry `photoUrl`, `coverUrl`, `avatarUrl` as presigned GETs of the right size.

Erasing a person deletes their avatar objects. Removing a studio (docs/32 section 10) deletes `media/<org>/`.
Audit: `media.uploaded`, `media.removed` with purpose and owner id.

## 7. Instructor note on a class (C11)

`sessions.member_note text CHECK (length(member_note) <= 200)` and the same column on `templates` (copied to new
sessions at materialization; editing the template does not touch sessions already created, as with the instructor).
Edited by `schedule.manage` or the session's own instructor (`PUT /sessions/{id}/member-note`). Shown to booked and
waitlisted members on the class screen and in the home card. Migration 0026. Audit `session.note_updated`.

## 8. Check-in at the door (C12, C14)

### 8.1 The code

- Migration 0027: `people.people` gets `checkin_secret bytea` (32 random bytes), created on first use, cleared on
  erase.
- `GET /me/checkin-code` returns `{ code, validForSeconds }`. The code is `TCI1.<personId short>.<6 digits>` where
  the digits are HOTP(secret, floor(unix time / 30)) (RFC 4226 truncation). The app redraws the QR when it rotates.
  The response also says whether a booking is open for check-in now and for which session.
- `POST /checkins` (`attendance.mark` or the instructor of the matching session) with `{ code, sessionId? }`:
  verifies the digits for the current window and the previous one, finds the person's live booking whose session
  starts within the next 30 minutes or is running (or the given `sessionId`), marks it `attended`
  (docs/29 6.4) and returns the person's name, avatar, spot label and health-declaration state for the scanner
  screen. A code that was already accepted in its window is accepted again but does nothing new (idempotent).
- Errors: `checkin.invalid_code`, `checkin.no_booking`, `checkin.too_early`. Five invalid scans from one staff
  member in a minute return `429`.
- Audit: `booking.checked_in` (booking id, method `code`).

### 8.2 Apps

The member app shows the QR in the home card from 30 minutes before the class ("כניסה"), full-screen with maximum
brightness hint. The console's live class screen has "סריקת כרטיס כניסה" (camera through `BarcodeDetector`, with a
manual 6-digit entry fallback for browsers without it) and tap-to-mark on the map.

## 9. Owner insights (C18 to C23)

All under `reports.view` (docs/32 R-1), computed live (X-10), studio time zone, `today` as in docs/32 section 4.

### 9.1 Sales and forecast

`GET /insights/sales?month=2026-10`: sum of `pass_products.price_agorot` of passes granted (`passes.created_at`
in the month, `status` not voided), the same for the previous month up to the same day, and a forecast:
`soFar / daysElapsed * daysInMonth`, rounded to the shekel; `null` before day 3 (too little to say). The response
has the daily cumulative series for the chart. Passes from a product with no price count as 0 and are reported in
`unpricedCount`.

### 9.2 Week occupancy

`GET /insights/occupancy?week=2026-10-18`: for each day (Sunday to Saturday) and part of day (morning before 12:00,
noon 12:00 to 16:59, evening from 17:00, in the studio's time zone): `places / capacity` of scheduled sessions, and
a `full_with_waitlist` flag when any session there was full with someone waiting. The week figure is the total.

### 9.3 Suggestions

`GET /insights/suggestions` returns at most three cards, ordered by money at stake:

1. `members_at_risk`: count and the first three names (docs/32 list).
2. `passes_ending`: count and the sum of their products' prices.
3. `waitlist_pressure`: a future session in the next 7 days that is full with 4 or more waiting, plus the first
   free slot the same day in a room of that capacity where the session's instructor has nothing scheduled ("עומר
   פנוי ב-19:15"). Acting on it opens the "new class" dialog prefilled; nothing is created automatically.

### 9.4 What happens now

`GET /insights/activity?limit=20` (`reports.view` and `people.view`): a merged, time-ordered list from the last
48 hours of: bookings created, cancelled and promoted (with the spot), passes granted (with product and price),
health declarations signed, check-ins. Each item: kind, time, person `{ id, displayName, avatarUrl }`, and a few
typed fields. The console polls it every 30 seconds while the page is visible.

### 9.5 Search anything

`GET /search?q=` (min 2 characters, 8 results per group): people (`people.view`, existing name search), sessions
in the next 14 days by class type or instructor name (`schedule.view`), and console pages and actions matched
locally in the app. Ctrl K on a computer, the search field on a phone.

### 9.6 Messages from a suggestion

"שליחת הודעה אישית" and "הצעת חידוש" open the existing announcement composer (migration 0016) with the selected
people and a prefilled template; sending uses the existing delivery path (in-app, push, email when SES allows).
No new sending mechanism.

## 10. Pace history (C3)

`GET /me/progress` adds `weeks`: the last 12 weeks (Sunday to Saturday, G-2) with `attended` and `booked` (a future
booking this week), so the home screen draws the dot history. The goal stays monthly (docs/31 section 12); the
home screen says "יעד: 12 בחודש" for a goal of 12. No migration.

## 11. Permissions

No new catalog key. Mapping: room layout and spots `schedule.manage`; spot of any booking `bookings.manage`; own
spot self; staff profile self or `schedule.manage`; media by purpose (section 6.3); check-in `attendance.mark` or
instructor; insights `reports.view` (+ `people.view` where names appear); buddies self only.

## 12. Privacy

- Members see other members only as "taken" (X-4). A buddy link is mutual consent, ends from either side, and is
  deleted on erase.
- The check-in QR identifies the person only together with a secret held by the server; a photo of the QR is
  useless after a minute.
- The live class screen shows health-declaration *status*, never answers (docs/31).
- Pictures are private objects behind short-lived URLs; nothing is public on the internet.

## 13. Tests

- **Integration (PostgreSQL 18):** RLS on every new table; 10 parallel bookings choosing the same spot give exactly
  one booking on it and nine errors with no place or entry leaked; X-3 assignment; promotion assigns a spot;
  maintenance spot can't be booked; layout shrink below booked is 409; buddy code is one-use, expires, rate-limits;
  erase removes buddies, codes, avatar and check-in secret; check-in accepts the current and previous window only
  and is idempotent; sales sum ignores voided passes; occupancy parts of day across DST.
- **API flow:** a member books a spot next to a buddy, staff scan the code, the live map shows attended.
- **Apps:** unit tests for the map (keyboard: arrows move between spots, Enter picks), e2e on dev at 360 and 1280 px
  for the four mockup screens.

## 14. Delivery plan

One PR each; migrations in this order, one writer at a time (CLAUDE.md):

| Step | PR | Migration |
|---|---|---|
| E0 | This LLD, D16 to D19, design-system doc v1.0, the mockups in `docs/design/` | |
| E1 | Contract: every endpoint above in `contracts/openapi/tempo-api.v1.yaml` | |
| E2 | Rooms with spots, booking with a spot, spot preferences, `/sessions/{id}/spots` | 0024 |
| E3 | Buddies | 0025 |
| E4 | Storage stack + media upload + covers, instructor photos, avatars; staff profiles; member note | 0026 |
| E5 | Check-in code and scan | 0027 |
| E6 | Insights: sales, occupancy, suggestions, activity, search; progress weeks | |
| E7 | Design system v1.0 "Warm Glass" in `packages/design-system` (tokens, fonts, glass, paper, room map, slide) | |
| E8 | Member app redesign (home, schedule, booking with map, booking done, profile with buddies) | |
| E9 | Console redesign (today dashboard, live class, rooms editor, instructor profiles, search) | |
| E10 | e2e at 360 and 1280 px for the redesigned screens; the reference artifact updated | |

As delivered (2026-10-17), stacked in this order: E2 #324, E3 #326, E4 #331, E5 #332, E6 #334, E7 and E8 together #337,
E9 #340. E1 did not get a PR of its own: each step added its own endpoints to the contract, so the contract and the code
behind it are reviewed together. E10's screen checks run on each PR (Playwright `screens`, six sizes, 44px targets); the
dev API serves `main`, so the new cards and maps show on dev only after the stack merges.

# Authorization and People LLD (Phase 2)

> **Status:** Approved by Kris, 2026-10-15. Every open question in section 14 is decided (the default in each
> case); the **Proposed** choices below are **Decisions**.
> **Audience:** Engineering, AI coding agents
> **Inputs:** `26_Identity_Organization_Membership_LLD.md` (Phase 1), `03_Domain_Driven_Design.md` section 5,
> `04_Multi_Tenant_Architecture.md`, `09_Authentication_&_Authorization.md`, `12_CRM_Architecture.md` section 1,
> `20_Security.md`, `24_Development_Roadmap.md` section 4, ADR-0006, ADR-0007, ADR-0021, ADR-0023, the Studio mockup
> (`docs/design/mockups/studio-2026-10-13/`)
> **Decision policy:** as in docs/26. Every **Proposed** choice below is a **Decision** since the document merged
> (#47); the former open questions are decided in section 14.

## 1. Scope

Phase 2 replaces Phase 1's four fixed roles with permissions, and gives a studio a record of the people it serves,
whether or not they ever sign in.

In scope:

- a permission catalog with stable keys;
- roles as named sets of permissions, the four Phase 1 roles seeded as system roles;
- role assignments on memberships, and one evaluation path for every tenant route;
- owner transfer and step-up for privileged actions;
- `Person` records inside a studio: name, contact points, consent, relationships (a parent of a child client);
- linking a client membership to its person record, and people without a login (walk-ins, a child);
- duplicate candidates and an explicit merge;
- erasure (anonymize a person) and export of one person's data.

Out of scope, and where it goes:

| Item | Phase |
|---|---|
| Plans, entitlements, restricted mode | 3 (Billing) |
| Sending messages, honouring consent at send time | 4 (Communications); Phase 2 only records consent |
| Leads, pipelines, CRM tasks, notes | 6 (CRM), on top of the person record |
| Health declarations and other sensitive vertical data | Studio vertical, own LLD (P-5, section 14) |
| Location or class scoped permissions ("staff sees only their classes") | With Scheduling; the model leaves room (section 3.4) |
| Support sessions (impersonation) | After the pilot starts, own LLD, read-only first (A-4, section 14) |

## 2. What changes from Phase 1

| Phase 1 | Phase 2 |
|---|---|
| `memberships.role` text, one of four | `role_assignments` rows; a membership can hold several roles |
| `RolePolicy` static functions (`Modules/Organizations/Domain/RolePolicy.cs`) | `RequirePermission("<key>")` on each route, evaluated from the database |
| `client` membership with no profile | `client` membership linked to a `people.people` row |
| One owner, set at creation, never transferable | One owner, transferable with step-up and the new owner's acceptance |
| `GET /me` returns `role` | `GET /me` returns `roles` and `permissions` per studio; `role` stays one release for the apps |

The 403 code stays `permission.denied` (D11). Phase 1 behaviour must not change for any of the four roles: the
Phase 1 role matrix tests run unchanged against the new evaluation path before `RolePolicy` is deleted.

## 3. Authorization

### 3.1 Permission catalog

**Proposed.** Permissions are defined in code, not in the database: one static catalog class per module, keys in
lowercase dot notation (`03_Domain_Driven_Design.md` section 10). A key never changes meaning; a retired key is
removed from the catalog and from roles in one migration. The database stores keys as text and a CI test checks
every stored key against the catalog.

Phase 2 catalog:

| Key | What it allows | Phase 1 equivalent |
|---|---|---|
| `organization.view` | Read the studio | any member |
| `organization.settings.manage` | Edit name, locale, time zone | owner, admin |
| `members.view` | List members | owner, admin, staff |
| `members.invite.staff` | Invite staff and clients, manage the join link | owner, admin |
| `members.invite.admin` | Invite admins | owner |
| `members.manage` | Change status, assign roles that hold no `*.admin`-level permission | owner, admin (staff and clients) |
| `roles.manage` | Create and edit custom roles, assign any role but owner | owner |
| `audit.view` | Read the studio's audit log | owner, admin |
| `people.view` | List and read person records | owner, admin, staff |
| `people.manage` | Create and edit people, contact points, relationships | owner, admin, staff (A-2, section 14) |
| `people.merge` | Resolve duplicate candidates | owner, admin |
| `people.export` | Export one person's data | owner, admin |
| `people.erase` | Anonymize a person | owner |
| `consent.manage` | Record consent on someone's behalf (paper form) | owner, admin |
| `ownership.transfer` | Start an owner transfer | owner |

Rules that are not permissions, because no role should be able to change them:

- Nobody can grant the owner role by assignment; only an owner transfer moves it (section 3.5).
- A member cannot change their own roles or status.
- A member may always read and edit their own person record and their own consent (the "self" rule, section 3.4).

### 3.2 Roles

**Proposed.**

- **System roles** `owner`, `admin`, `staff`, `client`: rows with `organization_id IS NULL`, seeded by migration,
  identical in every studio, not editable. Their permission sets are the Phase 1 equivalents in the table above.
- **Custom roles** (A-1: not in Phase 2; the model is ready): rows with an `organization_id`, created by a member with `roles.manage`,
  holding any subset of the catalog except `ownership.transfer` and `people.erase`.
- A member with `members.manage` but not `roles.manage` can assign only roles whose permissions are a subset of their
  own. This prevents an admin from creating a role stronger than themselves.

### 3.3 Role assignments

- A membership holds one or more roles. Phase 1 data migrates one-for-one: each membership gets the system role named
  in `memberships.role`.
- Exactly one live `owner` assignment per studio, enforced by a partial unique index (as Phase 1's
  `ux_memberships_one_owner`).
- `memberships.role` stays, read-only, for one release so the apps and the Phase 1 contract keep working, then a
  migration drops it.

### 3.4 Evaluation

**Proposed.**

1. The tenant route filter (docs/26 section 6) loads the membership and, in the same query, the union of the
   permission keys of its live role assignments. The result goes into `TenantContext.Permissions`, an immutable set.
2. Each endpoint declares `RequirePermission("<key>")`. Missing key: 403 `permission.denied`. Default deny: an
   endpoint without a declaration fails an architecture test.
3. Resource rules run in the application service after the permission check. Phase 2 has two:
   - **self:** a member acting on their own person record or consent needs no `people.*` permission;
   - **rank:** `members.manage` cannot touch a member who holds a permission the actor lacks.
4. No permissions in tokens. Evaluation reads the database on every request, so a role change applies on the next
   request and no token needs revoking. The cost is one query per request, which the route filter already makes.

The model leaves room for scope: `role_assignments.scope_type` and `scope_id` exist with only `organization` allowed in
Phase 2. Scheduling can add `location` or `class` scopes without a new table.

### 3.5 Owner transfer

**Proposed.**

1. The owner calls `POST /ownership-transfer` with the target membership. The target must be an active admin.
   Step-up applies (section 3.6).
2. The target sees the pending transfer in `GET /me` and accepts with `POST /ownership-transfer/accept`, or declines.
   It expires after 72 hours.
3. On acceptance, in one transaction: the target gets `owner`, the old owner gets `admin`, audit
   `ownership.transferred`.

An operator can force a transfer (the owner is unreachable) through the platform API with a written reason and a
ticket reference. That is the only way to change the owner without the owner.

### 3.6 Step-up for privileged actions

Cognito has no built-in step-up, so the API checks how recent the sign-in is.

**Proposed.** Privileged actions need `auth_time` in the access token to be at most 10 minutes old; otherwise 401
`auth.step_up_required`, and the app sends the user through sign-in again. When the user has MFA on, sign-in includes
it, so step-up means "signed in with MFA within 10 minutes".

Privileged actions in Phase 2: owner transfer, creating or editing custom roles, assigning `admin` or any role with
`roles.manage`, `people.erase`, `people.export`.

Owner MFA (docs/26 O-3, and A-5 in section 14): O-3's default stands, mandatory for owners and admins before the
pilot. Enforcement: the API reads the user's MFA setting with `AdminGetUser` (already granted on the customer pool)
at session time and stores `mfa_enabled` on the account; owner and admin routes return 403 `auth.mfa_required` when it
is off, once the switch `TEMPO_REQUIRE_OWNER_MFA` is on.

## 4. People

### 4.1 One person record per studio

**Decided P-1 (shape A).** `09_Authentication_&_Authorization.md` speaks of a "canonical person". Two shapes:

- **A, per studio (default).** A person record belongs to one studio. The same human in two studios is two records,
  each linked to the same `UserAccount` if they sign in. Nothing about a person crosses studios.
- **B, global person.** One `Person` row for the human, and an `OrganizationPerson` per studio holding the studio's
  view.

The default is A because under Israel's Privacy Protection Law each studio is the owner of its own database and Tempo
processes it for them; a global record would let one studio's data shape another's, and every query would need a
second isolation rule. The "canonical" link is the `UserAccount`: the human's login is global, their records are not.
Shape A keeps the DDD names: `OrganizationPerson` is what this document calls a person record.

Fields (shape A):

- `given_name`, `family_name`, `display_name` (Hebrew or any script);
- `birth_date` (optional; needed to tell a child from an adult);
- `status`: `active`, `archived`, `anonymized`;
- `user_account_id`: the login, when the person has one; unique per studio;
- `source`: `join_link`, `invitation`, `staff_created`, `import`.

### 4.2 Contact points

- Types: `email`, `phone`. Several per person; one primary per type.
- Phones are stored in E.164 (`+972...`). Israeli local input (`050-...`) is normalized on write.
- A contact point linked to the login (the account's verified email) is marked `verified` and changes only when the
  account's email changes.
- Contact points are not unique per studio: a parent and a child can share a phone. Shared values feed duplicate
  detection (section 4.6), not constraints.

### 4.3 Consent

Phase 2 records consent; Phase 4 enforces it when sending.

- One row per person, purpose and channel: purposes `marketing`, `reminders`; channels `email`, `push`, `whatsapp`.
- Each row keeps the state (`granted`, `withdrawn`), when, how (`self`, `staff_on_behalf`, `import`), who recorded
  it, and the version of the text the person agreed to.
- Withdrawal is a new row, never an update; the current state is the latest row. History is the proof.
- Marketing defaults to not granted. Israeli law (Communications Law section 30A) needs prior consent for marketing
  messages; reminders about a booked class are service messages. To confirm with a lawyer before the pilot (open
  question P-4).

### 4.4 Relationships

- `person_relationships`: `guardian_of` (parent or guardian of a child) and `emergency_contact_for`.
- A guardian with a login can book for and see the bookings of the people they are guardian of. This is the first
  "relationship" policy input from `09` section 5; it arrives with Scheduling but the data comes now.
- **P-3 (decided):** the table ships now; booking on a child's behalf waits for Scheduling.

### 4.5 Linking memberships and people

**Proposed.**

| Event | Person record |
|---|---|
| Client joins by link | Find a person in the studio with no login whose verified-email contact matches; link it. Otherwise create one from the account (name, email). |
| Invitation accepted | The invitation may carry `person_id` (staff invited someone they already recorded); link that one. Otherwise as above. |
| Staff create a walk-in | A person with no login. Later "invite to the app" creates an invitation carrying `person_id`. |
| Staff and admins | Also get a person record, so a staff member who takes a class is one record, not two. |
| Member removed | The person stays (bookings and payments refer to it), unlinked from the membership; `archived` if they have no other role. |

A person has at most one login per studio, and a login has at most one person per studio (two unique indexes).

### 4.6 Duplicate candidates

- On create and on contact change, the API looks for people in the same studio with the same normalized email or
  phone, or the same name and birth date. Each match becomes a `duplicate_candidates` row with the reason; nothing is
  merged automatically.
- A member with `people.merge` resolves it: `merge` (pick the surviving record) or `not_duplicate`.
- Merge moves contact points, consent history, relationships and the login link to the survivor, marks the other
  `merged_into`, and writes audit with both ids. Later modules (bookings, payments) subscribe to a
  `PersonMerged` event to repoint their rows.
- Two records that both have a login cannot be merged (they are two humans who share a phone).

### 4.7 Erasure and export

- **Erase** (`people.erase`, step-up): replace names, contact points and birth date with null or a placeholder, set
  `status = anonymized`, delete consent rows' free text but keep their state and timestamps, unlink the login. Rows
  that other modules need (a booking happened) keep the id. Audit keeps ids only.
- **Export** (`people.export`, step-up): a JSON document of one person's record, contacts, consent history and
  relationships, built synchronously in Phase 2 (small), returned once, audited.
- Retention of archived people: seven years (P-2), to confirm with an accountant before the pilot.

## 5. Database

Migration `0005_authorization_people.sql` (Phase 1 ends at `0004_tripwires.sql`). Same conventions as docs/26 section 7: UUID v7, `timestamptz`, `version`
on mutable rows, tenant-leading primary keys and composite foreign keys, RLS enabled (not forced) with the tenant
clause.

```sql
CREATE SCHEMA authz;    -- not "authorization", which is an SQL keyword
CREATE SCHEMA people;

CREATE TABLE authz.roles (
    id              uuid PRIMARY KEY,
    organization_id uuid REFERENCES organizations.organizations (id),   -- NULL = system role
    key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
    display_name    text NOT NULL,
    is_system       boolean NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_roles_key ON authz.roles (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'), key);

CREATE TABLE authz.role_permissions (
    role_id        uuid NOT NULL REFERENCES authz.roles (id),
    permission_key text NOT NULL,
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE authz.role_assignments (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    membership_id   uuid NOT NULL,
    role_id         uuid NOT NULL REFERENCES authz.roles (id),
    scope_type      text NOT NULL DEFAULT 'organization' CHECK (scope_type IN ('organization')),
    scope_id        uuid,
    status          text NOT NULL CHECK (status IN ('active', 'revoked')),
    granted_by      uuid,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, membership_id) REFERENCES organizations.memberships (organization_id, id)
);
CREATE UNIQUE INDEX ux_role_assignments_live ON authz.role_assignments (organization_id, membership_id, role_id)
    WHERE status = 'active';

CREATE TABLE organizations.ownership_transfers (
    organization_id      uuid NOT NULL,
    id                   uuid NOT NULL,
    from_membership_id   uuid NOT NULL,
    to_membership_id     uuid NOT NULL,
    status               text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    expires_at           timestamptz NOT NULL,
    created_at           timestamptz NOT NULL,
    updated_at           timestamptz NOT NULL,
    version              bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX ux_ownership_transfers_one_pending ON organizations.ownership_transfers (organization_id)
    WHERE status = 'pending';

CREATE TABLE people.people (
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    id              uuid NOT NULL,
    given_name      text,
    family_name     text,
    display_name    text NOT NULL,
    birth_date      date,
    status          text NOT NULL CHECK (status IN ('active', 'archived', 'anonymized', 'merged')),
    merged_into_id  uuid,
    user_account_id uuid REFERENCES identity.user_accounts (id),
    membership_id   uuid,
    source          text NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, membership_id) REFERENCES organizations.memberships (organization_id, id),
    FOREIGN KEY (organization_id, merged_into_id) REFERENCES people.people (organization_id, id)
);
CREATE UNIQUE INDEX ux_people_login ON people.people (organization_id, user_account_id) WHERE user_account_id IS NOT NULL;
CREATE UNIQUE INDEX ux_people_membership ON people.people (organization_id, membership_id) WHERE membership_id IS NOT NULL;

CREATE TABLE people.contact_points (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    person_id       uuid NOT NULL,
    type            text NOT NULL CHECK (type IN ('email', 'phone')),
    value           text NOT NULL,          -- email lowercased, phone E.164
    is_primary      boolean NOT NULL,
    verified        boolean NOT NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);
CREATE INDEX ix_contact_points_value ON people.contact_points (organization_id, type, value);

CREATE TABLE people.consents (          -- append-only
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    person_id       uuid NOT NULL,
    purpose         text NOT NULL CHECK (purpose IN ('marketing', 'reminders')),
    channel         text NOT NULL CHECK (channel IN ('email', 'push', 'whatsapp')),
    state           text NOT NULL CHECK (state IN ('granted', 'withdrawn')),
    method          text NOT NULL CHECK (method IN ('self', 'staff_on_behalf', 'import')),
    text_version    text NOT NULL,
    recorded_by     uuid,
    occurred_at     timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, person_id) REFERENCES people.people (organization_id, id)
);

CREATE TABLE people.person_relationships (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    from_person_id  uuid NOT NULL,
    to_person_id    uuid NOT NULL,
    type            text NOT NULL CHECK (type IN ('guardian_of', 'emergency_contact_for')),
    created_at      timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, from_person_id) REFERENCES people.people (organization_id, id),
    FOREIGN KEY (organization_id, to_person_id) REFERENCES people.people (organization_id, id),
    CHECK (from_person_id <> to_person_id)
);

CREATE TABLE people.duplicate_candidates (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL,
    person_a_id     uuid NOT NULL,
    person_b_id     uuid NOT NULL,
    reason          text NOT NULL CHECK (reason IN ('email', 'phone', 'name_birth_date')),
    status          text NOT NULL CHECK (status IN ('open', 'merged', 'not_duplicate')),
    resolved_by     uuid,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    CHECK (person_a_id < person_b_id)
);
CREATE UNIQUE INDEX ux_duplicate_candidates_pair ON people.duplicate_candidates (organization_id, person_a_id, person_b_id);
```

Grants and RLS:

- `tempo_app`: DML on `authz.role_assignments`, `authz.roles` and `authz.role_permissions` rows of its tenant (system
  roles readable by everyone, writable by nobody at runtime); DML on `people.*` except UPDATE and DELETE on
  `people.consents` (append-only, like audit).
- `tempo_platform`: SELECT on both schemas; UPDATE on `authz.role_assignments` for forced owner transfer.
- Policies: the tenant clause from docs/26 section 7.3 on every tenant table. `authz.roles` adds
  `OR organization_id IS NULL` for reads. `people.people` adds the self clause
  (`user_account_id = app.user_account_id`) for reads, so a client's `GET /me/profile` works per studio.

Data migration in the same script: one `role_assignments` row per live membership, from `memberships.role`; one
`people.people` row per live membership, from the account's display name and email, with a verified email contact
point.

## 6. API

Tenant routes under `/api/v1/organizations/{organizationId}` (customer scheme). Every route names its permission.

| Method and path | Permission |
|---|---|
| `GET /roles` | `members.view` |
| `POST /roles`, `PATCH /roles/{roleId}`, `DELETE /roles/{roleId}` | `roles.manage`, step-up. **Not in Phase 2** (A-1: system roles only); added when a studio asks for custom roles |
| `GET /permissions` (the catalog, for the role editor) | `roles.manage` |
| `PUT /members/{membershipId}/roles` (the full set; exactly one system role in Phase 2) | `members.manage`, rank rule first, then step-up when it grants `admin` |
| `POST /ownership-transfer`, `DELETE /ownership-transfer` | `ownership.transfer`, step-up |
| `POST /ownership-transfer/accept`, `POST /ownership-transfer/decline` | the target member |
| `GET /people?query=&status=&before=&limit=` | `people.view` |
| `POST /people`, `GET /people/{personId}`, `PATCH /people/{personId}` | `people.manage`, `people.view`, `people.manage` (or self) |
| `POST /people/{personId}/contact-points`, `PATCH`, `DELETE` | `people.manage` (or self) |
| `GET /people/{personId}/consents`, `POST /people/{personId}/consents` | `people.view` / `consent.manage` (or self) |
| `POST /people/{personId}/relationships`, `DELETE` | `people.manage` |
| `POST /people/{personId}/invite` (invitation carrying `person_id`) | `members.invite.staff` |
| `GET /duplicate-candidates`, `POST /duplicate-candidates/{id}/resolve` | `people.merge` |
| `POST /people/{personId}/export` | `people.export`, step-up |
| `POST /people/{personId}/erase` | `people.erase`, step-up |

Account routes: `GET /api/v1/me` gains `roles`, `permissions` and `pendingOwnershipTransfer` per studio;
`GET /api/v1/organizations/{organizationId}/me/profile` and `PATCH` for a member's own person record and consent.

Platform route: `POST /api/v1/platform/organizations/{organizationId}/force-owner-transfer` with `{ toMembershipId,
reason, ticket }`.

New error codes: `auth.step_up_required` (401), `auth.mfa_required` (403), `role.system_readonly`,
`role.in_use`, `role.exceeds_actor`, `ownership.transfer_pending`, `ownership.target_not_admin`,
`ownership.transfer_not_found`, `person.not_found`, `person.has_login`, `person.merge_both_have_login`,
`contact_point.invalid_phone`, `consent.invalid`.

The OpenAPI contract for this section is the first PR after this LLD, as in Phase 1.

## 7. Audit

New actions: `role.created`, `role.updated`, `role.deleted`, `role_assignment.changed` (before and after sets),
`ownership.transfer_started`, `ownership.transfer_cancelled`, `ownership.transferred`,
`ownership.transferred_by_operator`, `person.created`, `person.updated`, `person.linked`, `person.archived`,
`person.merged`, `person.exported`, `person.erased`, `consent.recorded`, `duplicate.resolved`.

`data` never holds contact values or names for `person.*` events, only ids and the names of changed fields, so the
audit log never needs erasing.

## 8. Code layout

```text
backend/Tempo.Platform/Modules/
  Authorization/   PermissionCatalog, Role, RoleAssignment, PermissionEvaluator, OwnershipTransfer
  People/          Person, ContactPoint (phone normalization), Consent, PersonRelationship, DuplicateDetector, Merge
backend/Tempo.Api/
  Authorization/   RequirePermission endpoint filter, step-up check
```

`Organizations/Domain/RolePolicy.cs` is deleted in the last PR, after the Phase 1 role matrix passes on the new path.
Phone normalization uses `libphonenumber-csharp` (Apache 2.0, NuGet), approved by Kris on 2026-10-15.

## 9. Infrastructure

None. No new AWS resources, no new SSM parameters, $0 (ADR-0021). The API already has `AdminGetUser` on the customer
pool, which MFA enforcement reads.

## 10. Apps

- The apps read `permissions` from `GET /me` to show or hide actions; the API stays the only enforcement.
- Admin app: roles screen, member role editor, people list and person card, duplicates queue, owner transfer.
- Client app: "my details" and consent toggles (the AppProfile notifications card in the mockup), guardian view later.

## 11. Tests

- **Unit:** permission catalog keys unique and well-formed; rank rule; every cell of the Phase 1 role matrix through
  `PermissionEvaluator` with the seeded system roles; phone normalization (Israeli mobile and landline, with and
  without `+972`); duplicate detection reasons; merge moves every child row.
- **Architecture:** every tenant endpoint declares a permission; no code outside `Authorization` reads `authz.*`.
- **Integration (PostgreSQL 18):** migration 0005 on a database with Phase 1 data produces one assignment and one
  person per live membership; RLS on every new table (tenant A cannot see tenant B; no setting reads empty);
  `tempo_app` cannot UPDATE or DELETE consents; system roles cannot be modified by `tempo_app`.
- **API:** the `09` section 7 matrix with permissions instead of roles: missing permission, correct permission,
  self, rank violation, step-up too old, wrong tenant (404).

## 12. Delivery plan

One PR each, in order:

1. This LLD (merged after Kris answers section 14).
2. OpenAPI contract for section 6.
3. Migration 0005 with data backfill and the integration tests.
4. Authorization module, `RequirePermission`, `GET /me` additions; all existing routes switch to permissions with
   the Phase 1 matrix tests unchanged.
5. Roles API and assignments (custom roles only if A-1 says so).
6. Step-up check and owner transfer (tenant and platform).
7. People module: people, contact points, linking on join and accept.
8. Consent and relationships.
9. Duplicates and merge.
10. Export and erasure.
11. Drop `memberships.role` and `RolePolicy` (after the apps read `roles`).

## 13. Risks

- **Backfill on prod data.** There is no prod data yet; if Phase 2 lands after the pilot starts, migration 0005 runs
  against real studios and needs a dry run on a Neon branch first.
- **One more query per request.** The permission union joins three small tables keyed by membership; measure on the
  Neon pooler before step 4 merges.
- **Consent wording.** The legal text and its versions are product decisions, not code (P-4).

## 14. Decisions on the open questions

Kris accepted every default on 2026-10-15 (day board #60, decision 1). P-2 and P-4 still get an accountant's and a
lawyer's check before the pilot; neither blocks code.

| Id | Question | Decided by Kris, 2026-10-15 |
|---|---|---|
| A-1 | Custom roles in Phase 2, or only the four system roles with the model ready for more? | Only the four system roles; custom roles when a studio asks |
| A-2 | Can staff (instructors) create and edit person records, or only view? | Create and edit (walk-ins at the front desk), not merge, export or erase |
| A-3 | Step-up window for privileged actions | Sign-in within the last 10 minutes |
| A-4 | Support sessions ("enter as support", the Impersonate mockup screen) in Phase 2? | Not in Phase 2; own LLD after the pilot starts, read-only first |
| A-5 | MFA mandatory for owners and admins: from when? (docs/26 O-3) | Before the pilot, behind `TEMPO_REQUIRE_OWNER_MFA` |
| P-1 | Person record per studio (A) or one global person with a per-studio view (B)? | A, per studio (section 4.1) |
| P-2 | How long to keep archived people (former members) before anonymizing? | Seven years, matching typical Israeli bookkeeping retention; confirm with an accountant |
| P-3 | Children at the pilot (guardian bookings)? | Table ships, guardian booking waits for Scheduling |
| P-4 | Consent texts and the marketing opt-in: who writes them, and a lawyer's check? | Kris writes them in Hebrew; a lawyer checks before the pilot |
| P-5 | Health declaration (shown as signed in the AppProfile mockup): Phase 2, or the Studio vertical? | Studio vertical, with its own sensitive-data design |
| P-6 | Required fields when staff create a walk-in | Display name and one phone or email |

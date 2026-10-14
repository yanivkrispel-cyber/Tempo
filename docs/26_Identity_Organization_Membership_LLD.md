# Identity, Organization and Membership LLD (Phase 1)

> **Status:** Draft for review, 2026-10-14
> **Audience:** Engineering, AI coding agents
> **Inputs:** `04_Multi_Tenant_Architecture.md`, `07_Database_Architecture.md`, `09_Authentication_&_Authorization.md`,
> ADR-0006 (amended 2026-10-14), ADR-0007, ADR-0021, ADR-0022, ADR-0023, LLD section 41
> **Decision policy:** statements marked **Decision** are normative once this document merges. Statements marked
> **Open** need the product owner's answer; each has a default that applies if nobody objects.

## 1. Scope

Phase 1 delivers the smallest set that lets a real studio exist in Tempo:

- internal user accounts linked to Cognito identities;
- organizations (studios), with an owner;
- memberships with a fixed role set;
- invitations for staff and admins, and a join link for clients;
- tenant resolution and tenant context, enforced in the API and in PostgreSQL;
- an append-only audit log;
- a basic platform console: list studios, view one, suspend and reactivate;
- the 10-studio backup tripwire.

Out of scope, and where it goes:

| Item | Phase |
|---|---|
| Configurable roles, permission assignments, policies | 2 (Authorization) |
| Person, OrganizationPerson, contacts, consent; linking a client membership to a person record | 2 (People) |
| Owner transfer, step-up authentication for privileged actions | 2 |
| Impersonation (support sessions) | 2, after the console exists |
| Trial, past-due and restricted states | 3 (Billing) |
| Invitation emails | When the domain exists and SES leaves the sandbox (see section 8.3) |
| Organization groups, multiple locations | Later |

## 2. Identity

### 2.1 Two user pools

**Decision (ADR-0023).**

| Pool | Users | Sign-up | MFA | App clients |
|---|---|---|---|---|
| `tempo-{env}-users` | Studio owners, admins, staff, clients | Self sign-up, verified email | Optional TOTP | `admin-web`, `client-web` |
| `tempo-{env}-operators` | The Tempo team | Admin-created only | Required, TOTP | `platform-admin-web` |

The operator pool uses shorter sessions: access token 15 minutes, refresh token 12 hours. Customer pool sessions stay
as in Phase 0 (1 hour, 30 days).

### 2.2 Tokens the API accepts

**Decision.** The API registers two JWT bearer schemes, one per issuer. Each keeps the Phase 0 checks: access tokens
only (`token_use=access`) and `client_id` in an allow-list for that pool.

| Route prefix | Scheme | A token from the other pool |
|---|---|---|
| `/api/v1/platform/*` | `operator` | 401 |
| every other authenticated route | `customer` | 401 |

Configuration: `COGNITO_ISSUER` and `COGNITO_CLIENT_IDS` (customer, as today), plus `COGNITO_OPERATOR_ISSUER` and
`COGNITO_OPERATOR_CLIENT_IDS`.

### 2.3 Internal accounts and the Cognito link

**Decision.** Tempo's identity is the internal `UserAccount`. A Cognito identity is an `ExternalIdentity`: issuer
plus `sub`, unique together. Nothing in the domain keys on `sub`.

Account provisioning is just-in-time. After sign-in the app calls `POST /api/v1/session`:

1. Look up `(issuer, sub)`. If it exists, return the account.
2. Otherwise read the user's email and `email_verified` with Cognito `AdminGetUser`, then insert the account and the
   external identity in one transaction. A unique-constraint race returns the row the other request created.

Cognito access tokens carry no `email` claim, which is why step 2 reads it from Cognito. The Phase 0 `/me` endpoint
reads `email` from the access token, so it returns no email today; Phase 1 replaces it. The API's role gets
`cognito-idp:AdminGetUser` on the customer pool only.

Email changes: `POST /api/v1/session` refreshes `email` and `email_verified` from Cognito when the token's
`auth_time` is newer than the stored `identity_synced_at`.

Operators are not `UserAccount`s. They live in `platform_admin.operators`, provisioned the same way from the operator
pool, and only when an administrator has pre-registered their email (section 9).

### 2.4 Account rules

- Status: `active`, `disabled`. A disabled account gets 403 `account.disabled` on every route except `GET /api/v1/me`.
- Creating a studio or accepting an invitation requires `email_verified = true`.
- One account may belong to any number of studios.

## 3. Organizations

### 3.1 Model

An organization is a studio in Phase 1. Fields follow `07_Database_Architecture.md` section 4, with Israel as the
default: country `IL`, locale `he-IL`, time zone `Asia/Jerusalem`, currency `ILS`.

- `slug`: lowercase Latin letters, digits and hyphens, 3 to 40 characters, unique. Used in the join link and later in
  client URLs. Hebrew display names are fine; the slug is separate.
- Status in Phase 1: `active` or `suspended`. The full lifecycle of `04_Multi_Tenant_Architecture.md` section 8
  arrives with billing.

### 3.2 Creating a studio

`POST /api/v1/organizations`, by any active account with a verified email:

- one transaction: the organization, an `owner` membership for the caller, and audit events
  `organization.created` and `membership.created`;
- limit: an account can create at most 3 organizations in Phase 1 (`organization.creation_limit`), to blunt abuse of
  open sign-up.

### 3.3 Suspension

Only operators suspend or reactivate, with a written reason. While suspended:

- members can still sign in and see the studio in `GET /api/v1/me`, marked suspended;
- every tenant route of that studio returns 403 `organization.suspended`, except reads of the organization itself.

## 4. Memberships and roles

### 4.1 Fixed roles for Phase 1

**Decision.** Four roles, stored as text on the membership. Phase 2 replaces them with role assignments and
permissions; the role names become seeded system roles then.

| Capability | owner | admin | staff | client |
|---|---|---|---|---|
| View and edit studio settings | yes | yes | view | no |
| Invite admins | yes | no | no | no |
| Invite staff and clients, manage the join link | yes | yes | no | no |
| List members | yes | yes | yes | no |
| Change a member's role or suspend a member | yes, anyone but themselves | staff and clients only | no | no |
| View the audit log | yes | yes | no | no |
| Leave the studio | no (needs owner transfer, Phase 2) | yes | yes | yes |

Rules:

- Every organization has exactly one owner in Phase 1.
- The owner role cannot be granted by invitation or role change. It is set only when the studio is created.
- A client is a membership with role `client`. Linking it to a `Person` record is Phase 2.

### 4.2 States

```text
invited ─► active ─► suspended ─► active
              │            │
              └──► removed ◄┘
```

`removed` is terminal and keeps the row for audit. Rejoining creates a new membership; the unique constraint applies
to non-removed memberships only.

In Phase 1 memberships are created `active` directly (on studio creation, invitation acceptance or join). `invited`
is reserved for the Phase 2 flow where an invitation creates the membership up front.

## 5. Invitations and the join link

### 5.1 Invitations

For staff, admins and, optionally, clients.

- Created by `POST /api/v1/organizations/{organizationId}/invitations` with `email` and `role`.
- Token: 32 random bytes, base64url. Only its SHA-256 hash is stored. The full link is returned once, in the create
  response.
- Valid for 7 days. States: `pending`, `accepted`, `revoked`, `expired` (expiry is computed on read; no job needed).
- Bound to the email address: acceptance requires the caller's verified email to match, compared case-insensitively.
  Otherwise 403 `invitation.email_mismatch`.
- One pending invitation per email and studio. Creating a new one revokes the old one.

### 5.2 Join link for clients

- Each studio has at most one active join code: 16 random bytes, base64url, stored as a hash. Owners and admins
  create, rotate or disable it. Rotation invalidates the old link at once.
- The link is `https://<client app>/join/<code>`. Accepting it creates an `active` client membership.
- **Open O-2:** should joining by link need the studio's approval? Default: no, the member is active at once, and the
  owner can suspend a member or rotate the link.

### 5.3 Preview and accept

Tokens never travel in a URL path or query sent to the API, because access logs record them.

| Call | Body | Result |
|---|---|---|
| `POST /api/v1/invitations/preview` | `{ token }` | studio name, role, inviter's display name, expiry |
| `POST /api/v1/invitations/accept` | `{ token }` | the new membership |
| `POST /api/v1/join/preview` | `{ code }` | studio name |
| `POST /api/v1/join` | `{ code }` | the new membership |

Accepting when already an active member returns the existing membership (idempotent). Preview and accept are
rate-limited per account (section 10.3).

## 6. Tenant resolution and context

**Decision.** The tenant comes from the route only: `/api/v1/organizations/{organizationId}/...`. No header, no
session state.

Per request, a filter on the `organizations/{organizationId}` route group:

1. Resolve the account from the token (`ExternalIdentity`).
2. Load the caller's membership in that organization.
3. No membership, or a `removed` one: **404** `organization.not_found`, the same answer as for an organization that
   does not exist, so IDs cannot be enumerated.
4. Suspended membership: 403 `membership.suspended`. Suspended organization: section 3.3.
5. Build an immutable `TenantContext`: `organizationId`, `userAccountId`, `membershipId`, `role`, `correlationId`.

Repositories for tenant-owned tables take `TenantContext` as a required parameter. There is no overload without it.

## 7. Database

### 7.1 Schemas and tables

Three schemas in Phase 1: `identity`, `organizations`, `audit`, plus `platform_admin` for operators. IDs are UUID v7,
generated in .NET (`Guid.CreateVersion7()`). Timestamps are `timestamptz` in UTC. Every mutable table has `version
bigint` for optimistic concurrency.

```sql
CREATE TABLE identity.user_accounts (
    id                 uuid PRIMARY KEY,
    status             text NOT NULL CHECK (status IN ('active', 'disabled')),
    email              text NOT NULL,
    email_verified     boolean NOT NULL,
    display_name       text,
    locale             text NOT NULL DEFAULT 'he-IL',
    identity_synced_at timestamptz NOT NULL,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    version            bigint NOT NULL DEFAULT 0
);
CREATE INDEX ix_user_accounts_email ON identity.user_accounts (lower(email));

CREATE TABLE identity.external_identities (
    id              uuid PRIMARY KEY,
    user_account_id uuid NOT NULL REFERENCES identity.user_accounts (id),
    issuer          text NOT NULL,
    subject         text NOT NULL,
    created_at      timestamptz NOT NULL,
    UNIQUE (issuer, subject)
);

CREATE TABLE organizations.organizations (
    id                 uuid PRIMARY KEY,
    slug               text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
    display_name       text NOT NULL,
    status             text NOT NULL CHECK (status IN ('active', 'suspended')),
    country_code       char(2) NOT NULL DEFAULT 'IL',
    default_locale     text NOT NULL DEFAULT 'he-IL',
    time_zone          text NOT NULL DEFAULT 'Asia/Jerusalem',
    currency_code      char(3) NOT NULL DEFAULT 'ILS',
    join_code_hash     bytea UNIQUE,
    created_by_user_id uuid NOT NULL REFERENCES identity.user_accounts (id),
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    version            bigint NOT NULL DEFAULT 0
);

CREATE TABLE organizations.memberships (
    organization_id uuid NOT NULL REFERENCES organizations.organizations (id),
    id              uuid NOT NULL,
    user_account_id uuid NOT NULL REFERENCES identity.user_accounts (id),
    role            text NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'client')),
    status          text NOT NULL CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    version         bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id)
);
CREATE UNIQUE INDEX ux_memberships_one_live ON organizations.memberships (organization_id, user_account_id)
    WHERE status <> 'removed';
CREATE UNIQUE INDEX ux_memberships_one_owner ON organizations.memberships (organization_id)
    WHERE role = 'owner' AND status <> 'removed';
CREATE INDEX ix_memberships_user ON organizations.memberships (user_account_id) WHERE status <> 'removed';

CREATE TABLE organizations.invitations (
    organization_id          uuid NOT NULL REFERENCES organizations.organizations (id),
    id                       uuid NOT NULL,
    email                    text NOT NULL,
    role                     text NOT NULL CHECK (role IN ('admin', 'staff', 'client')),
    token_hash               bytea NOT NULL UNIQUE,
    status                   text NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
    expires_at               timestamptz NOT NULL,
    invited_by_membership_id uuid NOT NULL,
    accepted_membership_id   uuid,
    created_at               timestamptz NOT NULL,
    updated_at               timestamptz NOT NULL,
    version                  bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, invited_by_membership_id) REFERENCES organizations.memberships (organization_id, id),
    FOREIGN KEY (organization_id, accepted_membership_id) REFERENCES organizations.memberships (organization_id, id)
);
CREATE UNIQUE INDEX ux_invitations_one_pending ON organizations.invitations (organization_id, lower(email))
    WHERE status = 'pending';

CREATE TABLE audit.audit_events (
    id              uuid PRIMARY KEY,
    organization_id uuid REFERENCES organizations.organizations (id),
    occurred_at     timestamptz NOT NULL,
    actor_type      text NOT NULL CHECK (actor_type IN ('user', 'operator', 'system')),
    actor_id        uuid,
    action          text NOT NULL,
    target_type     text NOT NULL,
    target_id       uuid,
    correlation_id  text NOT NULL,
    data            jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_audit_events_org_time ON audit.audit_events (organization_id, occurred_at DESC);

CREATE TABLE platform_admin.operators (
    id          uuid PRIMARY KEY,
    email       text NOT NULL UNIQUE,
    issuer      text,
    subject     text,
    status      text NOT NULL CHECK (status IN ('active', 'disabled')),
    created_at  timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL,
    version     bigint NOT NULL DEFAULT 0,
    UNIQUE (issuer, subject)
);
```

Tenant-owned tables (`memberships`, `invitations`) lead with `organization_id` in the primary key, and child foreign
keys include it, so a row can never point at another tenant's row (structural isolation, ADR-0006).

### 7.2 Database roles

| Role | Used by | Rights |
|---|---|---|
| `tempo_migrator` | the migrator | owns all schemas and objects |
| `tempo_app` | API and Worker, tenant and account routes | DML on `identity` and `organizations`; INSERT and SELECT only on `audit.audit_events`; no rights on `platform_admin` |
| `tempo_platform` (new) | API, `/api/v1/platform/*` only | SELECT on all four schemas; UPDATE of `organizations.status`; INSERT on `audit.audit_events`; DML on `platform_admin` |

The migrator bootstraps `tempo_platform` like the other two. Its password is the new SSM parameter
`/tempo/<env>/db/platform-password`, written by a person.

The audit table is append-only for every runtime role: no UPDATE or DELETE grants.

### 7.3 Row-level security

**Decision (ADR-0006 amendment).** RLS is the second layer on every tenant-owned table, and on the organizations table
itself. The API sets two values at the start of each transaction, never per session, because the Neon pooler runs
in transaction mode:

```sql
SELECT set_config('app.user_account_id', $1, true),
       set_config('app.organization_id', $2, true);   -- empty when the route has no tenant
```

Policies for `tempo_app`:

```sql
ALTER TABLE organizations.memberships ENABLE ROW LEVEL SECURITY;

-- tenant routes see their tenant; account routes (GET /me) see the caller's own memberships
CREATE POLICY memberships_app ON organizations.memberships TO tempo_app
USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR user_account_id = nullif(current_setting('app.user_account_id', true), '')::uuid
)
WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
```

- `organizations.invitations` and `audit.audit_events`: the tenant clause only.
- `organizations.organizations`: visible when `id` is the current tenant or the caller has a live membership in it.
  Insert is allowed when the row's `created_by_user_id` is the caller (studio creation runs before any tenant
  exists).
- `tempo_platform` gets `USING (true)` policies; it needs no `BYPASSRLS`.
- Finding an invitation by token, or a studio by join code, happens before any tenant is known. Two
  `SECURITY DEFINER` functions owned by `tempo_migrator`, with a fixed `search_path`, take the hash and return only the
  row needed: `organizations.find_invitation_by_token_hash(bytea)` and
  `organizations.find_organization_by_join_code_hash(bytea)`. `tempo_app` gets EXECUTE on them and nothing broader.

RLS is enabled, not forced. The owner (`tempo_migrator`) is therefore exempt, which is what lets the two lookup
functions read a row before a tenant is known. Runtime roles own no objects, so RLS always applies to them.

A missing setting makes the policy compare against NULL, so a query outside a proper transaction returns no rows
(fails closed).

### 7.4 Data access

**Decision.** Plain Npgsql with hand-written SQL, no ORM. It is already referenced, keeps Lambda cold starts small,
and makes the tenant filter visible in every query. One `NpgsqlDataSource` per role. A unit of work opens the
transaction, sets the RLS values and commits.

### 7.5 Migration

One migration, `0002_identity_organizations_audit.sql`, creates all of the above. Later Phase 1 changes are new
numbered scripts. Only Kris's machine writes migrations during Phase 1 (`docs/claude-memory/project-status.md`).

## 8. API

### 8.1 Account routes (customer scheme, no tenant)

| Method and path | Purpose |
|---|---|
| `POST /api/v1/session` | Provision or refresh the account (section 2.3). Returns the same body as `GET /me`. |
| `GET /api/v1/me` | The account and its live memberships: studio id, name, slug, role, membership status, studio status. 404 `account.not_provisioned` before the first session call. |
| `PATCH /api/v1/me` | Display name, locale. |
| `POST /api/v1/organizations` | Create a studio (section 3.2). |
| `POST /api/v1/invitations/preview`, `POST /api/v1/invitations/accept` | Section 5.3. |
| `POST /api/v1/join/preview`, `POST /api/v1/join` | Section 5.3. |

### 8.2 Tenant routes (customer scheme, `/api/v1/organizations/{organizationId}`)

| Method and path | Roles |
|---|---|
| `GET /` | any member |
| `PATCH /` | owner, admin |
| `GET /members` | owner, admin, staff |
| `PATCH /members/{membershipId}` (role, status) | owner, admin, per section 4.1 |
| `DELETE /members/{membershipId}` | owner, admin; or the member themselves (leave) |
| `GET /invitations`, `POST /invitations`, `DELETE /invitations/{invitationId}` | owner, admin (admins cannot invite admins) |
| `PUT /join-link` (create or rotate), `DELETE /join-link` | owner, admin |
| `GET /audit-events?before=&limit=` | owner, admin |

Lists use keyset pagination (`before` = the last item's id, `limit` up to 100).

### 8.3 Invitation delivery

**Open O-1.** There is no domain yet, and SES in the sandbox only sends to verified addresses, so Tempo cannot email
invitations to real people. Default: the create response returns the link, and the owner shares it (for example on
WhatsApp). Email delivery is added with the domain, before the pilot, through the outbox and the worker.

### 8.4 Platform routes (operator scheme, `/api/v1/platform`)

| Method and path | Purpose |
|---|---|
| `GET /organizations?status=&before=&limit=` | List studios with member counts |
| `GET /organizations/{organizationId}` | Studio details, owner, member counts by role |
| `POST /organizations/{organizationId}/suspend` | `{ reason }`, audited |
| `POST /organizations/{organizationId}/reactivate` | `{ reason }`, audited |
| `GET /stats` | Active studio count, accounts, memberships |

Every platform call runs as `tempo_platform` and writes an audit event with `actor_type = 'operator'`, including
reads of a single studio.

### 8.5 Errors

Problem Details as in `05_Backend_Architecture.md` section 3, with a stable `code`. New codes: `account.not_provisioned`,
`account.disabled`, `account.email_not_verified`, `organization.not_found`, `organization.suspended`,
`organization.slug_taken`, `organization.creation_limit`, `membership.suspended`, `membership.forbidden_role_change`,
`membership.owner_cannot_leave`, `invitation.not_found`, `invitation.expired`, `invitation.email_mismatch`,
`join.not_found`, `concurrency.conflict`.

Added while building Phase 1 (PRs #34 to #39):

| Code | Status | When |
|---|---|---|
| `auth.unauthorized` | 401 | Missing, invalid or wrong-pool token |
| `permission.denied` | 403 | The caller's role does not allow the action (section 4.1) |
| `operator.not_registered` | 403 | An operator-pool token with no active `platform_admin.operators` row |
| `membership.not_found` | 404 | The member does not exist in this studio, or was removed |
| `invitation.expired` | 410 | Accept after expiry, to the matching email only |
| `rate_limited` | 429 | Over 20 invitation or join attempts in an hour, with `Retry-After` |
| `request.empty`, `request.invalid`, `<field>.invalid`, `display_name.length`, `slug.invalid`, `time_zone.unknown`, `locale.unsupported`, `email.invalid`, `reason.length`, `if_match.invalid` | 400 | Validation; `errors` names the field |

Invalid, expired, revoked and unknown tokens all return the same `invitation.not_found` to the preview call, so a
token cannot be probed for state. Accept returns `invitation.expired` only to a caller whose email matches.

### 8.6 Contract

The OpenAPI document for all of section 8 goes in `contracts/openapi/tempo-api.v1.yaml` as the first PR after this
LLD, before the implementation. The frontend builds against it (`docs/claude-memory/project-status.md`).

## 9. Platform operators

- An administrator creates the operator in the Cognito operator pool and adds a row to `platform_admin.operators`
  with the same email (through the migrator's seed script per environment, or a CLI command; no API for it in Phase 1).
- On the first operator session the API links `(issuer, sub)` to that row. An operator token whose email has no row
  gets 403.
- Kris is the first operator.

## 10. Cross-cutting

### 10.1 Audit

Written in the same transaction as the change. Phase 1 actions:

`organization.created`, `organization.updated`, `organization.suspended`, `organization.reactivated`,
`organization.viewed_by_operator`, `membership.created`, `membership.role_changed`, `membership.suspended`,
`membership.reactivated`, `membership.removed`, `invitation.created`, `invitation.revoked`, `invitation.accepted`,
`join_link.rotated`, `join_link.disabled`, `membership.joined_via_link`.

`data` holds the changed fields (before and after) and never tokens, codes or hashes.

### 10.2 The 10-studio tripwire

The owner's rule: alert at 10 active studios and move to hourly backups (ADR-0021). Production already uses its ten
alarms, so this is not an alarm.

- A daily EventBridge Scheduler job sends a message to the work queue; the worker counts active organizations.
- When the count reaches 10 for the first time, it publishes to the existing `tempo-<env>-alarms` SNS topic (email
  to the owner) and records that it did, so it fires once. Dev has no alarm topic; there the job only logs.
- Cost: inside the Always Free tiers of Scheduler, SQS, Lambda and SNS email.

### 10.3 Abuse limits

- Verified email before creating a studio or accepting anything.
- At most 3 studios created per account (section 3.2).
- Invitation and join preview or accept: at most 20 attempts per account per hour, counted in PostgreSQL (no Redis,
  ADR-0013).
- The WAF rate rule covers sign-up and API floods once the edge is on in dev.

### 10.4 Studio owner MFA

**Open O-3.** ADR-0007 asks for MFA on privileged tenant accounts. Default: optional for owners at launch, offered in
the console; made mandatory for owners and admins before the pilot, with step-up for sensitive actions in Phase 2.

## 11. Code layout

```text
backend/Tempo.Platform/
  BuildingBlocks/
    Persistence/      NpgsqlDataSource per role, UnitOfWork (transaction + RLS settings)
    Tenancy/          TenantContext, AccountContext
    Errors/           DomainRuleViolation -> Problem Details codes
    Ids/              strongly typed ids over UUID v7
  Modules/
    Identity/         UserAccount, ExternalIdentity, session provisioning, Cognito adapter
    Organizations/    Organization, Membership, Invitation, JoinLink, role rules
    Audit/            AuditWriter, audit queries
    PlatformAdmin/    Operator, platform queries and commands
backend/Tempo.Api/
  Endpoints/          one file per route group, mapping DTOs to commands and queries
  Tenancy/            route filter that builds TenantContext
```

Each module follows `05_Backend_Architecture.md` section 1 (Domain, Application, Infrastructure, Contracts, Api), and
no module reads another module's tables.

## 12. Infrastructure changes

| Change | Stack | Cost |
|---|---|---|
| Operator user pool, its domain and the `platform-admin-web` client; that client removed from the customer pool | Identity | $0 |
| API environment: operator issuer and client ids | Api | $0 |
| API role: `cognito-idp:AdminGetUser` on the customer pool | Api | $0 |
| SSM parameter `/tempo/<env>/db/platform-password` (written by a person); API and migrator read it | Database, Api | $0 |
| Daily tripwire schedule | Async | Always Free |

The fixed-cost guard test must stay green. Changing the `platform-admin-web` client replaces it; no app uses it yet.

## 13. Tests

- **Unit:** role rules (section 4.1 table, every cell), membership state transitions, invitation expiry and email
  match, slug validation.
- **Integration (Testcontainers, PostgreSQL 18):**
  - the migration applies on an empty database and reapplies nothing;
  - RLS: as `tempo_app`, with tenant A set, reads and writes of tenant B rows return or affect nothing; without any
    setting, every tenant table reads empty;
  - composite foreign keys reject a cross-tenant reference;
  - `tempo_app` cannot UPDATE or DELETE audit events.
- **API (WebApplicationFactory with test tokens):** the matrix of `09_Authentication_&_Authorization.md` section 7:
  anonymous, no membership, suspended membership, each role, wrong tenant (404, not 403), operator token on a tenant
  route, customer token on a platform route.
- **Smoke test after deploy:** unchanged in Phase 1; it gains `POST /session` once a test user exists in dev.

## 14. Delivery plan

One PR each, in order, each with green CI and review from the other developer:

1. This LLD and ADR-0023.
2. OpenAPI contract for section 8.
3. Infrastructure (section 12) with CDK tests.
4. Migration 0002 with role bootstrap and the integration tests of section 13.
5. Building blocks: data sources, unit of work, two JWT schemes, tenant route filter, error mapping.
6. Session, `GET /me`, `PATCH /me`.
7. Organizations and memberships.
8. Invitations and the join link.
9. Audit reads, platform routes, the tripwire job.

## 15. Open questions

| Id | Question | Default if nobody objects |
|---|---|---|
| O-1 | Invitations without email until the domain exists | The inviter gets a link to share (section 8.3) |
| O-2 | Joining by link without studio approval | Active at once; the owner can suspend or rotate the link (section 5.2) |
| O-3 | MFA for studio owners | Optional at launch, mandatory before the pilot (section 10.4) |

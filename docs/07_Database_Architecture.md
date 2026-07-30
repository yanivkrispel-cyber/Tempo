# Database Architecture

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Primary Store

**Decision:** PostgreSQL is the transactional system of record.

## 2. Schema Ownership

```text
identity.*
organizations.*
authorization.*
people.*
billing.*
entitlements.*
communications.*
files.*
integrations.*
audit.*
platform_admin.*
vertical_<name>.*
```

No module directly queries another module's private tables.

## 3. Conventions

- UUID/ULID consistently.
- UTC timestamptz.
- money as integer minor units + currency.
- immutable tenant ownership.
- concurrency version.
- snake_case.
- explicit foreign keys.
- JSONB only for justified extensibility.
- stable enum strategy.

## 4. Example

```sql
CREATE TABLE organizations.organizations (
    id uuid PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    display_name text NOT NULL,
    status text NOT NULL,
    country_code char(2) NOT NULL,
    default_locale text NOT NULL,
    time_zone text NOT NULL,
    currency_code char(3) NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    version bigint NOT NULL DEFAULT 0
);
```

```sql
CREATE TABLE organizations.memberships (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations.organizations(id),
    user_id uuid NOT NULL REFERENCES identity.user_accounts(id),
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    UNIQUE (organization_id, user_id)
);
```

## 5. Indexing

- index FKs.
- tenant-leading composite indexes.
- indexes match predicates and sort.
- partial indexes for active subsets.
- every index documents supported query.
- monitor execution plans.

## 6. Migrations

Expand → dual write/backfill → validate → switch reads → contract later.

Migrations must be deterministic, tested on production-like volume, avoid long locks and define a forward-fix path.

## 7. Read Models

Use for dashboards, timelines, search, reports and cross-module views. They may be eventually consistent and rebuildable.

## 8. Retention

Each dataset defines sensitivity, owner, retention, export, deletion/anonymization and legal hold.

## 9. Backup and Recovery

- automated backup.
- point-in-time recovery.
- encryption.
- restore drills.
- RPO/RTO.
- access audit.

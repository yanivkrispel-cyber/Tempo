# Scheduling Engine

> **Status:** Baseline architecture specification  
> **Audience:** Product, Architecture, Engineering, QA, Security, DevOps, Design, AI coding agents  
> **Scope rule:** The Platform Core remains industry-neutral. Studio-, coaching-, running-, clinic- and treatment-specific rules belong to vertical modules unless explicitly classified as shared business capabilities.  
> **Decision policy:** Statements marked **Decision** are normative. Statements marked **Open Decision** require an ADR before implementation.


## 1. Classification

Scheduling is a shared business capability above Platform Core. Vertical scheduling entities remain explicit.

## 2. Shared Concepts

- TimeRange.
- TimeZone.
- RecurrenceRule.
- CalendarResource.
- Availability.
- Reservation.
- Conflict.
- Exception.
- ExternalCalendarLink.

## 3. Time Rules

- persist UTC instants.
- retain source timezone for recurrence.
- use IANA timezones.
- explicitly test DST.
- RFC 5545-compatible rules.
- no unbounded synchronous generation.

## 4. Materialization

Persist definition and materialize a rolling horizon. Use deterministic occurrence keys. Future changes rebuild idempotently while historical occurrences remain stable.

## 5. Conflict Detection

Dimensions: staff, room, equipment, participant and capacity. Use transactional constraints/locking.

```sql
EXCLUDE USING gist (
  organization_id WITH =,
  resource_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
)
WHERE (status IN ('confirmed','held'));
```

## 6. Reservation State

```text
Available → Held → Confirmed
              ↘ Expired
Confirmed → Canceled
```

## 7. Calendar Sync

Internal source of truth by default. External IDs, sync cursor, webhook delta sync and reconciliation are required.

## 8. Events

- ScheduleDefinitionCreated.
- ScheduleOccurrencesMaterialized.
- ReservationHeld.
- ReservationConfirmed.
- ReservationCanceled.
- SchedulingConflictDetected.

## 9. Tests

DST, exceptions, concurrent reservations, duplicate confirmation, horizon extension, replay and tenant isolation.

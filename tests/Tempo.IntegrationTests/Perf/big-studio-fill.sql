-- A big studio's rows (board #511, K4 / S-5), run once by BigStudioPerfTests as tempo_migrator on a perf-big Neon
-- branch, never on the main branch. {0} is the studio the harness created through the API (with its owner, six
-- coaches, one member with a login, three rooms, six class types and two products). Everything here is fictional.
-- Ids are UUIDv7 at the row's own time, as the API writes them, so "newest first" by id stays true.
DO $$
DECLARE
    org uuid := '{0}';
    owner_membership uuid;
    coaches uuid[];
    room_ids uuid[];
    type_ids uuid[];
    card uuid;
    unlimited uuid;
    member_person uuid;
    today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
    given text[] := ARRAY['נועה','מאיה','רוני','טל','שירה','יעל','דנה','עדי','ליאור','גלית','אורי','יובל','עומר','איתי','הילה','מיכל','נטע','רותם','שני','ענבל'];
    family text[] := ARRAY['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','פרידמן','שפירא','גולן','אלון','ברק','שחר','רון','נבון','דגן','אשכנזי'];
BEGIN
    SELECT id INTO owner_membership FROM organizations.memberships WHERE organization_id = org AND role = 'owner';
    SELECT array_agg(id ORDER BY created_at) INTO coaches FROM organizations.memberships WHERE organization_id = org AND role = 'staff';
    SELECT array_agg(id ORDER BY name) INTO room_ids FROM scheduling.rooms WHERE organization_id = org;
    SELECT array_agg(id ORDER BY name) INTO type_ids FROM scheduling.class_types WHERE organization_id = org;
    SELECT id INTO card FROM scheduling.pass_products WHERE organization_id = org AND kind = 'punch_card';
    SELECT id INTO unlimited FROM scheduling.pass_products WHERE organization_id = org AND kind = 'membership';
    SELECT p.id INTO member_person FROM people.people p
    JOIN organizations.memberships m ON m.organization_id = p.organization_id AND m.id = p.membership_id
    WHERE p.organization_id = org AND m.role = 'client';

    -- 1,499 more members without a login (the API's member is the 1,500th).
    INSERT INTO people.people (organization_id, id, given_name, family_name, display_name, status, source, created_at, updated_at)
    SELECT org, uuidv7(-(30 + n % 400) * interval '1 day'), given[1 + n % 20], family[1 + (n / 20) % 16],
           given[1 + n % 20] || ' ' || family[1 + (n / 20) % 16], 'active', 'import', now() - (30 + n % 400) * interval '1 day', now()
    FROM generate_series(2, 1500) n;

    CREATE TEMP TABLE perf_people ON COMMIT DROP AS
    SELECT id, (row_number() OVER (ORDER BY id))::int - 1 AS rn FROM people.people
    WHERE organization_id = org AND (membership_id IS NULL OR id = member_person);

    -- Ten classes a day, Sunday to Friday (60 a week), from a year back to eight weeks ahead.
    CREATE TEMP TABLE perf_sessions ON COMMIT DROP AS
    SELECT d::date AS local_date, (row_number() OVER (ORDER BY d, h))::int AS seq,
           (d::date + make_time(h, 0, 0)) AT TIME ZONE 'Asia/Jerusalem' AS starts_at
    FROM generate_series(today - 364, today + 56, interval '1 day') d,
         unnest(ARRAY[7, 8, 9, 10, 12, 17, 18, 19, 20, 21]) h
    WHERE extract(dow FROM d) <> 6;

    INSERT INTO scheduling.sessions (organization_id, id, local_date, class_type_id, starts_at, ends_at, instructor_membership_id, room_id, capacity, booked_count, status, created_at, updated_at)
    SELECT org, uuidv7(least(starts_at - interval '14 days', now()) - now()), local_date, type_ids[1 + (seq * 7) % 6], starts_at, starts_at + interval '50 minutes',
           coaches[1 + (seq * 5) % 6], room_ids[1 + seq % 3], 12, 0, CASE WHEN seq % 53 = 0 THEN 'cancelled' ELSE 'scheduled' END,
           least(starts_at - interval '14 days', now()), now()
    FROM perf_sessions;

    -- Places: seven to twelve on a past class, six in the coming week, two further ahead; distinct people per class
    -- (101 and 1,500 share no factor). A tenth of the past places were cancelled by the member, a twentieth no-shows.
    INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, cancel_reason, cancelled_at, booked_by, created_at, updated_at)
    SELECT org, uuidv7(least(s.starts_at - interval '3 days', now()) - now()), s.id, p.id,
           CASE WHEN s.starts_at > now() THEN 'booked' WHEN (s.seq + j) % 10 = 0 THEN 'cancelled' WHEN (s.seq + j) % 20 = 3 THEN 'no_show' ELSE 'attended' END,
           CASE WHEN s.starts_at <= now() AND (s.seq + j) % 10 = 0 THEN 'self' END,
           CASE WHEN s.starts_at <= now() AND (s.seq + j) % 10 = 0 THEN s.starts_at - interval '1 day' END,
           owner_membership, least(s.starts_at - interval '3 days', now()), now()
    FROM (SELECT ss.id, ss.starts_at, ps.seq FROM scheduling.sessions ss JOIN perf_sessions ps ON ps.starts_at = ss.starts_at
          WHERE ss.organization_id = org AND ss.status = 'scheduled') s
    CROSS JOIN LATERAL generate_series(0, CASE WHEN s.starts_at <= now() THEN 6 + s.seq % 6 WHEN s.starts_at <= now() + interval '7 days' THEN 5 ELSE 1 END) j
    JOIN perf_people p ON p.rn = (s.seq * 37 + j * 101) % 1500;

    -- The API's member: three places in the coming week, whatever the spread above gave her.
    INSERT INTO scheduling.bookings (organization_id, id, session_id, person_id, status, booked_by, created_at, updated_at)
    SELECT org, uuidv7(), ss.id, member_person, 'booked', owner_membership, now(), now()
    FROM scheduling.sessions ss
    WHERE ss.organization_id = org AND ss.status = 'scheduled' AND ss.starts_at BETWEEN now() + interval '1 day' AND now() + interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM scheduling.bookings b WHERE b.organization_id = org AND b.session_id = ss.id AND b.person_id = member_person)
    ORDER BY ss.starts_at LIMIT 3;

    UPDATE scheduling.sessions s SET booked_count = least(s.capacity, c.n)
    FROM (SELECT session_id, count(*)::int AS n FROM scheduling.bookings WHERE organization_id = org AND status IN ('booked', 'attended', 'no_show') GROUP BY session_id) c
    WHERE s.organization_id = org AND s.id = c.session_id;

    -- Passes back to back, 120 days each, from about 380 days ago: a 20-entry card for even members, unlimited for odd.
    INSERT INTO scheduling.passes (organization_id, id, person_id, product_id, starts_on, ends_on, entries, entries_used, status, granted_by, created_at, updated_at)
    SELECT org, uuidv7((-380 + p.rn % 30 + k * 120) * interval '1 day'), p.id, CASE WHEN p.rn % 2 = 0 THEN card ELSE unlimited END,
           today - 380 + p.rn % 30 + k * 120, today - 380 + p.rn % 30 + k * 120 + 119, CASE WHEN p.rn % 2 = 0 THEN 20 END, 0, 'active', owner_membership,
           now() + (-380 + p.rn % 30 + k * 120) * interval '1 day', now()
    FROM perf_people p CROSS JOIN generate_series(0, 3) k;

    INSERT INTO scheduling.pass_uses (organization_id, id, pass_id, booking_id, status, created_at, updated_at)
    SELECT DISTINCT ON (b.id) org, uuidv7(b.created_at - now()), ps.id, b.id, 'held', b.created_at, now()
    FROM scheduling.bookings b
    JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
    JOIN scheduling.passes ps ON ps.organization_id = b.organization_id AND ps.person_id = b.person_id AND s.local_date BETWEEN ps.starts_on AND ps.ends_on
    WHERE b.organization_id = org AND b.status IN ('booked', 'attended', 'no_show')
    ORDER BY b.id, ps.starts_on;

    UPDATE scheduling.passes ps SET entries_used = least(ps.entries, u.n)
    FROM (SELECT pass_id, count(*)::int AS n FROM scheduling.pass_uses WHERE organization_id = org AND status = 'held' GROUP BY pass_id) u
    WHERE ps.organization_id = org AND ps.id = u.pass_id AND ps.entries IS NOT NULL;

    -- Ten reminders a member about their latest places (thirty for the API's member), the older ones read.
    INSERT INTO notifications.inbox_items (organization_id, id, person_id, kind, data, read_at, created_at)
    SELECT org, uuidv7(t.at - now()), t.person_id, 'reminder.class_tomorrow', jsonb_build_object('sessionId', t.session_id, 'bookingId', t.id),
           CASE WHEN t.at < now() - interval '2 days' THEN t.at + interval '1 hour' END, t.at
    FROM (SELECT b.id, b.person_id, b.session_id, least(s.starts_at - interval '1 day', now()) AS at,
                 row_number() OVER (PARTITION BY b.person_id ORDER BY s.starts_at DESC) AS r
          FROM scheduling.bookings b JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
          WHERE b.organization_id = org) t
    WHERE t.r <= CASE WHEN t.person_id = member_person THEN 30 ELSE 10 END;

    INSERT INTO audit.audit_events (id, organization_id, occurred_at, actor_type, actor_id, action, target_type, target_id, correlation_id, data)
    SELECT uuidv7(b.created_at - now()), org, b.created_at, 'user', NULL, 'booking.created', 'booking', b.id, 'perf-big', '{}'::jsonb
    FROM scheduling.bookings b WHERE b.organization_id = org;
END $$;

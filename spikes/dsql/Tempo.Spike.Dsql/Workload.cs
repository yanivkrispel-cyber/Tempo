using System.Diagnostics;
using Npgsql;

namespace Tempo.Spike.Dsql;

/// <summary>
/// The studio workload, run as the least-privileged tempo_app role:
/// seed data, bookings under contention and without it, typical reads,
/// room-overlap protection, cross-tenant writes and a table export.
/// </summary>
public static class Workload
{
    // Fixed ids so every scenario can find the seeded studio without a lookup table.
    public static readonly Guid StudioA = Guid.Parse("a0000000-0000-4000-8000-000000000001");
    public static readonly Guid StudioB = Guid.Parse("b0000000-0000-4000-8000-000000000002");
    public static readonly Guid RoomA = Guid.Parse("a0000000-0000-4000-8000-0000000000a1");
    public static readonly Guid RoomB = Guid.Parse("b0000000-0000-4000-8000-0000000000b1");

    private const int SeedMembers = 200;
    private const int SeedSessions = 40;

    public static async Task<object> SeedAsync(SpikeTarget target)
    {
        await using var app = await target.OpenAsync(SpikeTarget.AppRole, 2);
        await using var conn = await app.DataSource.OpenConnectionAsync();
        var sw = Stopwatch.StartNew();

        var existing = await Sql.ScalarAsync<long>(conn, "SELECT count(*) FROM organizations.organizations WHERE id = $1", StudioA);
        if (existing > 0)
        {
            return new { scenario = "seed", engine = target.Engine.ToString(), skipped = "already seeded" };
        }

        var now = DateTime.UtcNow;
        await using (var tx = await conn.BeginTransactionAsync())
        {
            foreach (var (id, slug, room) in new[] { (StudioA, "studio-a", RoomA), (StudioB, "studio-b", RoomB) })
            {
                await Sql.ExecAsync(conn, tx,
                    "INSERT INTO organizations.organizations (id, slug, display_name, status, time_zone, created_at, updated_at) VALUES ($1, $2, $3, 'active', 'Asia/Jerusalem', $4, $4)",
                    id, slug, slug, now);
            }

            await tx.CommitAsync();
        }

        // Rooms reference organizations; a separate transaction keeps each one small.
        await using (var tx = await conn.BeginTransactionAsync())
        {
            await Sql.ExecAsync(conn, tx, "INSERT INTO scheduling.rooms (organization_id, id, name) VALUES ($1, $2, 'Studio 1')", StudioA, RoomA);
            await Sql.ExecAsync(conn, tx, "INSERT INTO scheduling.rooms (organization_id, id, name) VALUES ($1, $2, 'Studio 1')", StudioB, RoomB);
            await tx.CommitAsync();
        }

        await InsertMembersAsync(conn, StudioA, SeedMembers, now);
        await InsertMembersAsync(conn, StudioB, 5, now);

        // A week of classes, one per four hours, with room for every member.
        await using (var tx = await conn.BeginTransactionAsync())
        {
            for (var i = 0; i < SeedSessions; i++)
            {
                var starts = now.Date.AddDays(1).AddHours(6 + (i * 4));
                await Sql.ExecAsync(conn, tx,
                    "INSERT INTO scheduling.class_sessions (organization_id, id, room_id, title, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4, $5, $6, 1000)",
                    StudioA, Guid.NewGuid(), RoomA, $"Class {i + 1}", starts, starts.AddMinutes(50));
            }

            await Sql.ExecAsync(conn, tx,
                "INSERT INTO scheduling.class_sessions (organization_id, id, room_id, title, starts_at, ends_at, capacity) VALUES ($1, $2, $3, 'B class', $4, $5, 10)",
                StudioB, Guid.NewGuid(), RoomB, now.Date.AddDays(1).AddHours(8), now.Date.AddDays(1).AddHours(9));
            await tx.CommitAsync();
        }

        return new { scenario = "seed", engine = target.Engine.ToString(), members = SeedMembers, sessions = SeedSessions, ms = Math.Round(sw.Elapsed.TotalMilliseconds, 1) };
    }

    private static async Task InsertMembersAsync(NpgsqlConnection conn, Guid organizationId, int count, DateTime now)
    {
        await using var tx = await conn.BeginTransactionAsync();
        for (var i = 0; i < count; i++)
        {
            await Sql.ExecAsync(conn, tx,
                "INSERT INTO organizations.memberships (organization_id, id, user_id, role, status, display_name, created_at) VALUES ($1, $2, $3, 'member', 'active', $4, $5)",
                organizationId, Guid.NewGuid(), Guid.NewGuid(), $"Member {i + 1}", now);
        }

        await tx.CommitAsync();
    }

    private sealed record BookingOutcome(string Outcome, int Retries, double Ms, string? Error);

    /// <summary>
    /// One booking: the conditional UPDATE claims a seat only while
    /// booked_count is below capacity, and the INSERT records who holds it.
    /// Both run in one transaction, retried on SQLSTATE 40001.
    /// </summary>
    private static async Task<BookingOutcome> BookAsync(NpgsqlDataSource dataSource, Guid organizationId, Guid sessionId, Guid membershipId, int maxRetries)
    {
        var sw = Stopwatch.StartNew();
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await using var conn = await dataSource.OpenConnectionAsync();
                await using var tx = await conn.BeginTransactionAsync();
                var claimed = await Sql.ExecAsync(conn, tx,
                    "UPDATE scheduling.class_sessions SET booked_count = booked_count + 1, version = version + 1 " +
                    "WHERE organization_id = $1 AND id = $2 AND booked_count < capacity",
                    organizationId, sessionId);
                if (claimed == 0)
                {
                    await tx.RollbackAsync();
                    return new BookingOutcome("full", attempt, sw.Elapsed.TotalMilliseconds, null);
                }

                await Sql.ExecAsync(conn, tx,
                    "INSERT INTO scheduling.bookings (organization_id, id, session_id, membership_id, status, created_at) VALUES ($1, $2, $3, $4, 'confirmed', now())",
                    organizationId, Guid.NewGuid(), sessionId, membershipId);
                await tx.CommitAsync();
                return new BookingOutcome("booked", attempt, sw.Elapsed.TotalMilliseconds, null);
            }
            catch (Exception ex) when (Sql.IsRetryable(ex) && attempt < maxRetries)
            {
                await Task.Delay(Sql.Backoff(attempt));
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                return new BookingOutcome("duplicate", attempt, sw.Elapsed.TotalMilliseconds, null);
            }
            catch (Exception ex)
            {
                return new BookingOutcome("error", attempt, sw.Elapsed.TotalMilliseconds, (ex as PostgresException)?.SqlState + " " + ex.Message);
            }
        }
    }

    /// <summary>
    /// The registration-opens moment: <paramref name="attempts"/> members book
    /// a fresh class with <paramref name="capacity"/> seats at the same instant.
    /// Pass: exactly capacity bookings, booked_count == capacity, no errors.
    /// </summary>
    public static async Task<object> BookBurstAsync(SpikeTarget target, int attempts, int capacity, int maxRetries)
    {
        await using var app = await target.OpenAsync(SpikeTarget.AppRole, attempts);
        var dataSource = app.DataSource;
        var sessionId = Guid.NewGuid();

        await using (var conn = await dataSource.OpenConnectionAsync())
        {
            var starts = DateTime.UtcNow.Date.AddDays(14).AddHours(Random.Shared.Next(6, 20));
            await Sql.ExecAsync(conn,
                "INSERT INTO scheduling.class_sessions (organization_id, id, room_id, title, starts_at, ends_at, capacity) VALUES ($1, $2, $3, 'Burst class', $4, $5, $6)",
                StudioA, sessionId, RoomA, starts, starts.AddMinutes(50), capacity);
        }

        var members = await MemberIdsAsync(dataSource, StudioA, attempts);

        // Open every connection before the start line, so the measurement is
        // the booking itself and not TLS plus IAM authentication.
        var warm = await Task.WhenAll(Enumerable.Range(0, attempts).Select(_ => dataSource.OpenConnectionAsync().AsTask()));
        foreach (var c in warm)
        {
            await c.DisposeAsync();
        }

        // An async gate, not a blocking one: 100 threads parked on a wait handle
        // would make the thread pool ramp up slowly and stagger the start.
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var tasks = members.Select(async m =>
        {
            await gate.Task;
            return await BookAsync(dataSource, StudioA, sessionId, m, maxRetries);
        }).ToArray();
        var sw = Stopwatch.StartNew();
        gate.SetResult();
        var outcomes = await Task.WhenAll(tasks);
        var wallMs = sw.Elapsed.TotalMilliseconds;

        await using var check = await dataSource.OpenConnectionAsync();
        var bookedCount = await Sql.ScalarAsync<int>(check, "SELECT booked_count FROM scheduling.class_sessions WHERE organization_id = $1 AND id = $2", StudioA, sessionId);
        var bookingRows = await Sql.ScalarAsync<long>(check, "SELECT count(*) FROM scheduling.bookings WHERE organization_id = $1 AND session_id = $2", StudioA, sessionId);
        var distinctMembers = await Sql.ScalarAsync<long>(check, "SELECT count(DISTINCT membership_id) FROM scheduling.bookings WHERE organization_id = $1 AND session_id = $2", StudioA, sessionId);

        var booked = outcomes.Where(o => o.Outcome == "booked").ToArray();
        var pass = booked.Length == capacity && bookedCount == capacity && bookingRows == capacity && distinctMembers == capacity
                   && outcomes.All(o => o.Outcome is "booked" or "full");

        return new
        {
            scenario = "book-burst",
            engine = target.Engine.ToString(),
            attempts,
            capacity,
            pass,
            outcomes = outcomes.GroupBy(o => o.Outcome).ToDictionary(g => g.Key, g => g.Count()),
            bookedCount,
            bookingRows,
            distinctMembers,
            retries = new { total = outcomes.Sum(o => o.Retries), max = outcomes.Max(o => o.Retries) },
            latencyAll = Stats.Summarize(outcomes.Select(o => o.Ms).ToArray()),
            latencyBooked = Stats.Summarize(booked.Select(o => o.Ms).ToArray()),
            wallMs = Math.Round(wallMs, 1),
            errors = outcomes.Where(o => o.Error is not null).Select(o => o.Error).Distinct().Take(5)
        };
    }

    /// <summary>Bookings one at a time across the week's classes: the latency a member sees on a normal day.</summary>
    public static async Task<object> BookSteadyAsync(SpikeTarget target, int count)
    {
        await using var app = await target.OpenAsync(SpikeTarget.AppRole, 2);
        var dataSource = app.DataSource;
        var sessions = await SessionIdsAsync(dataSource, StudioA, 1000);
        var members = await MemberIdsAsync(dataSource, StudioA, SeedMembers);

        // Warm-up: the first transaction on a new connection pays for TLS and authentication.
        await using (var c = await dataSource.OpenConnectionAsync())
        {
            await Sql.ScalarAsync<int>(c, "SELECT 1");
        }

        // Session i % 40 with member (i + offset) % 200 gives distinct pairs for up
        // to 200 bookings in one run; the random offset avoids repeating an earlier run.
        var offset = Random.Shared.Next(members.Count);
        var outcomes = new List<BookingOutcome>();
        for (var i = 0; i < count; i++)
        {
            outcomes.Add(await BookAsync(dataSource, StudioA, sessions[i % sessions.Count], members[(i + offset) % members.Count], 10));
        }

        var booked = outcomes.Where(o => o.Outcome == "booked").Select(o => o.Ms).ToArray();
        return new
        {
            scenario = "book-steady",
            engine = target.Engine.ToString(),
            count,
            outcomes = outcomes.GroupBy(o => o.Outcome).ToDictionary(g => g.Key, g => g.Count()),
            retries = outcomes.Sum(o => o.Retries),
            latencyBooked = Stats.Summarize(booked),
            latencyAll = Stats.Summarize(outcomes.Select(o => o.Ms).ToArray())
        };
    }

    /// <summary>The three reads a studio app does most: the week's schedule, a member's bookings, a class roster.</summary>
    public static async Task<object> ReadsAsync(SpikeTarget target, int count)
    {
        await using var app = await target.OpenAsync(SpikeTarget.AppRole, 4);
        await using var conn = await app.DataSource.OpenConnectionAsync();
        await Sql.ScalarAsync<int>(conn, "SELECT 1");

        var members = await MemberIdsAsync(app.DataSource, StudioA, SeedMembers);
        var sessions = await SessionIdsAsync(app.DataSource, StudioA, 1000);
        var from = DateTime.UtcNow.Date;

        var queries = new Dictionary<string, Func<int, Task<int>>>
        {
            ["week-schedule"] = async _ => (await Sql.RowsAsync(conn,
                "SELECT id, title, starts_at, ends_at, capacity, booked_count FROM scheduling.class_sessions " +
                "WHERE organization_id = $1 AND starts_at >= $2 AND starts_at < $3 ORDER BY starts_at",
                StudioA, from, from.AddDays(8))).Count,
            ["member-bookings"] = async i => (await Sql.RowsAsync(conn,
                "SELECT b.id, s.title, s.starts_at FROM scheduling.bookings b " +
                "JOIN scheduling.class_sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id " +
                "WHERE b.organization_id = $1 AND b.membership_id = $2 AND s.starts_at >= $3 ORDER BY s.starts_at LIMIT 20",
                StudioA, members[i % members.Count], from)).Count,
            ["class-roster"] = async i => (await Sql.RowsAsync(conn,
                "SELECT m.display_name, b.status FROM scheduling.bookings b " +
                "JOIN organizations.memberships m ON m.organization_id = b.organization_id AND m.id = b.membership_id " +
                "WHERE b.organization_id = $1 AND b.session_id = $2 ORDER BY m.display_name",
                StudioA, sessions[i % sessions.Count])).Count
        };

        var results = new Dictionary<string, object>();
        foreach (var (name, query) in queries)
        {
            var samples = new List<double>();
            var rows = 0;
            for (var i = 0; i < count; i++)
            {
                var sw = Stopwatch.StartNew();
                rows += await query(i);
                samples.Add(sw.Elapsed.TotalMilliseconds);
            }

            results[name] = new { latency = Stats.Summarize(samples), avgRows = Math.Round((double)rows / count, 1) };
        }

        return new { scenario = "reads", engine = target.Engine.ToString(), count, results };
    }

    /// <summary>
    /// Ten staff members schedule overlapping classes in the same room at
    /// once. Room protection without EXCLUDE: SELECT ... FOR UPDATE on the
    /// room row makes the transactions conflict, then an overlap query decides.
    /// Pass: exactly one class created.
    /// </summary>
    public static async Task<object> RoomOverlapAsync(SpikeTarget target, int attempts)
    {
        await using var app = await target.OpenAsync(SpikeTarget.AppRole, attempts);
        var dataSource = app.DataSource;
        var slot = DateTime.UtcNow.Date.AddDays(30).AddHours(Random.Shared.Next(6, 20)).AddMinutes(Random.Shared.Next(0, 4) * 15);

        async Task<(string Outcome, int Retries, double Ms)> ScheduleAsync(int index)
        {
            var sw = Stopwatch.StartNew();
            for (var attempt = 0; ; attempt++)
            {
                try
                {
                    await using var conn = await dataSource.OpenConnectionAsync();
                    await using var tx = await conn.BeginTransactionAsync();
                    await Sql.ScalarAsync<Guid>(conn, tx, "SELECT id FROM scheduling.rooms WHERE organization_id = $1 AND id = $2 FOR UPDATE", StudioA, RoomA);
                    var starts = slot.AddMinutes(index * 5);
                    var ends = starts.AddMinutes(50);
                    var overlaps = await Sql.ScalarAsync<long>(conn, tx,
                        "SELECT count(*) FROM scheduling.class_sessions WHERE organization_id = $1 AND room_id = $2 AND starts_at < $3 AND ends_at > $4",
                        StudioA, RoomA, ends, starts);
                    if (overlaps > 0)
                    {
                        await tx.RollbackAsync();
                        return ("overlap", attempt, sw.Elapsed.TotalMilliseconds);
                    }

                    await Sql.ExecAsync(conn, tx,
                        "INSERT INTO scheduling.class_sessions (organization_id, id, room_id, title, starts_at, ends_at, capacity) VALUES ($1, $2, $3, $4, $5, $6, 20)",
                        StudioA, Guid.NewGuid(), RoomA, $"Overlap test {index}", starts, ends);
                    await tx.CommitAsync();
                    return ("created", attempt, sw.Elapsed.TotalMilliseconds);
                }
                catch (Exception ex) when (Sql.IsRetryable(ex) && attempt < 30)
                {
                    await Task.Delay(Sql.Backoff(attempt));
                }
            }
        }

        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var tasks = Enumerable.Range(0, attempts).Select(async i =>
        {
            await gate.Task;
            return await ScheduleAsync(i);
        }).ToArray();
        gate.SetResult();
        var outcomes = await Task.WhenAll(tasks);

        var created = outcomes.Count(o => o.Outcome == "created");
        return new
        {
            scenario = "room-overlap",
            engine = target.Engine.ToString(),
            attempts,
            pass = created == 1,
            outcomes = outcomes.GroupBy(o => o.Outcome).ToDictionary(g => g.Key, g => g.Count()),
            retries = outcomes.Sum(o => o.Retries),
            latency = Stats.Summarize(outcomes.Select(o => o.Ms).ToArray())
        };
    }

    /// <summary>
    /// Structural isolation: a booking that mixes studios must be rejected by
    /// the composite foreign keys, whatever the application code does.
    /// </summary>
    public static async Task<object> TenantIsolationAsync(SpikeTarget target)
    {
        await using var app = await target.OpenAsync(SpikeTarget.AppRole, 4);
        await using var conn = await app.DataSource.OpenConnectionAsync();
        var sessionA = (await SessionIdsAsync(app.DataSource, StudioA, 1))[0];
        var memberA = (await MemberIdsAsync(app.DataSource, StudioA, 1))[0];
        var memberB = (await MemberIdsAsync(app.DataSource, StudioB, 1))[0];

        const string insert = "INSERT INTO scheduling.bookings (organization_id, id, session_id, membership_id, status, created_at) VALUES ($1, $2, $3, $4, 'confirmed', now())";
        var cases = new (string Name, Guid Org, Guid Session, Guid Member)[]
        {
            ("studio B books studio A's class", StudioB, sessionA, memberB),
            ("studio A's class with studio B's member", StudioA, sessionA, memberB),
            ("studio B's row pointing at studio A's member", StudioB, sessionA, memberA)
        };

        var results = new List<object>();
        var allRejected = true;
        foreach (var c in cases)
        {
            var r = await Sql.TryAsync(() => Sql.ExecAsync(conn, insert, c.Org, Guid.NewGuid(), c.Session, c.Member));
            allRejected &= !r.Ok;
            results.Add(new { c.Name, rejected = !r.Ok, r.SqlState, r.Message });
        }

        return new { scenario = "tenant-isolation", engine = target.Engine.ToString(), pass = allRejected, results };
    }

    /// <summary>The daily export idea: COPY each table to CSV over the wire (would go to S3).</summary>
    public static async Task<object> ExportAsync(SpikeTarget target)
    {
        await using var app = await target.OpenAsync(SpikeTarget.AppRole, 1);
        await using var conn = await app.DataSource.OpenConnectionAsync();
        var tables = new[] { "organizations.organizations", "organizations.memberships", "scheduling.rooms", "scheduling.class_sessions", "scheduling.bookings" };
        var results = new List<object>();

        foreach (var table in tables)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                using var reader = await conn.BeginTextExportAsync($"COPY (SELECT * FROM {table}) TO STDOUT WITH (FORMAT csv, HEADER true)");
                var text = await reader.ReadToEndAsync();
                results.Add(new { table, ok = true, rows = text.Count(ch => ch == '\n') - 1, bytes = text.Length, ms = Math.Round(sw.Elapsed.TotalMilliseconds, 1) });
            }
            catch (PostgresException ex)
            {
                results.Add(new { table, ok = false, ex.SqlState, ex.MessageText });
            }
        }

        return new { scenario = "export", engine = target.Engine.ToString(), results };
    }

    private static async Task<List<Guid>> MemberIdsAsync(NpgsqlDataSource dataSource, Guid organizationId, int limit)
    {
        await using var conn = await dataSource.OpenConnectionAsync();
        var rows = await Sql.RowsAsync(conn, "SELECT id FROM organizations.memberships WHERE organization_id = $1 ORDER BY display_name LIMIT $2", organizationId, limit);
        return rows.Select(r => (Guid)r[0]!).ToList();
    }

    private static async Task<List<Guid>> SessionIdsAsync(NpgsqlDataSource dataSource, Guid organizationId, int limit)
    {
        await using var conn = await dataSource.OpenConnectionAsync();
        var rows = await Sql.RowsAsync(conn,
            "SELECT id FROM scheduling.class_sessions WHERE organization_id = $1 AND capacity = 1000 ORDER BY starts_at LIMIT $2", organizationId, limit);
        return rows.Select(r => (Guid)r[0]!).ToList();
    }
}

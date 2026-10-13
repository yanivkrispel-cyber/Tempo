using System.Diagnostics;
using Npgsql;

namespace Tempo.Spike.Dsql;

/// <summary>Small helpers so scenarios read as SQL, not ADO.NET plumbing.</summary>
public static class Sql
{
    public static async Task<int> ExecAsync(NpgsqlConnection conn, string sql, params object[] args)
    {
        await using var cmd = Command(conn, null, sql, args);
        return await cmd.ExecuteNonQueryAsync();
    }

    public static async Task<int> ExecAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, params object[] args)
    {
        await using var cmd = Command(conn, tx, sql, args);
        return await cmd.ExecuteNonQueryAsync();
    }

    public static async Task<T?> ScalarAsync<T>(NpgsqlConnection conn, string sql, params object[] args)
    {
        await using var cmd = Command(conn, null, sql, args);
        var value = await cmd.ExecuteScalarAsync();
        return value is null or DBNull ? default : (T)value;
    }

    public static async Task<T?> ScalarAsync<T>(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, params object[] args)
    {
        await using var cmd = Command(conn, tx, sql, args);
        var value = await cmd.ExecuteScalarAsync();
        return value is null or DBNull ? default : (T)value;
    }

    public static async Task<List<object?[]>> RowsAsync(NpgsqlConnection conn, string sql, params object[] args)
    {
        await using var cmd = Command(conn, null, sql, args);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<object?[]>();
        while (await reader.ReadAsync())
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[i] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }

            rows.Add(row);
        }

        return rows;
    }

    public static NpgsqlCommand Command(NpgsqlConnection conn, NpgsqlTransaction? tx, string sql, object[] args)
    {
        var cmd = new NpgsqlCommand(sql, conn, tx);
        foreach (var arg in args)
        {
            cmd.Parameters.Add(new NpgsqlParameter { Value = arg });
        }

        return cmd;
    }

    /// <summary>The SQLSTATE and message of a failed statement, or null on success.</summary>
    public static async Task<(bool Ok, string? SqlState, string? Message, double Ms)> TryAsync(Func<Task> action)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            await action();
            return (true, null, null, sw.Elapsed.TotalMilliseconds);
        }
        catch (PostgresException ex)
        {
            return (false, ex.SqlState, ex.MessageText, sw.Elapsed.TotalMilliseconds);
        }
        catch (NpgsqlException ex)
        {
            return (false, null, ex.Message, sw.Elapsed.TotalMilliseconds);
        }
    }

    /// <summary>
    /// True for the errors a client should retry: SQLSTATE 40001 is both
    /// DSQL's OCC conflict (OC000 data, OC001 schema) and PostgreSQL's
    /// serialization failure.
    /// </summary>
    public static bool IsRetryable(Exception ex) => ex is PostgresException { SqlState: "40001" };

    public static TimeSpan Backoff(int attempt)
    {
        // Exponential backoff with full jitter, capped at 1 second.
        var capMs = Math.Min(1000, 10 * Math.Pow(2, attempt));
        return TimeSpan.FromMilliseconds(Random.Shared.NextDouble() * capMs);
    }
}

public static class Stats
{
    public static object Summarize(IReadOnlyCollection<double> samples)
    {
        if (samples.Count == 0)
        {
            return new { count = 0 };
        }

        var sorted = samples.Order().ToArray();
        return new
        {
            count = sorted.Length,
            min = Round(sorted[0]),
            p50 = Round(Percentile(sorted, 0.50)),
            p90 = Round(Percentile(sorted, 0.90)),
            p95 = Round(Percentile(sorted, 0.95)),
            p99 = Round(Percentile(sorted, 0.99)),
            max = Round(sorted[^1]),
            mean = Round(sorted.Average())
        };
    }

    private static double Percentile(double[] sorted, double p)
    {
        // Nearest-rank percentile: the smallest sample with at least p of the samples at or below it.
        var rank = (int)Math.Ceiling(p * sorted.Length);
        return sorted[Math.Clamp(rank - 1, 0, sorted.Length - 1)];
    }

    private static double Round(double ms) => Math.Round(ms, 2);
}

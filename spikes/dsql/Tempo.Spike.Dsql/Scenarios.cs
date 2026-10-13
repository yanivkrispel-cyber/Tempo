using System.Diagnostics;
using System.Globalization;

namespace Tempo.Spike.Dsql;

public static class Scenarios
{
    public static async Task<object> RunAsync(string scenario, IReadOnlyDictionary<string, string> args)
    {
        var target = SpikeTarget.FromEnvironment();
        int Int(string key, int fallback) => args.TryGetValue(key, out var v) ? int.Parse(v, CultureInfo.InvariantCulture) : fallback;

        return scenario switch
        {
            "bootstrap" => await Migration.BootstrapAsync(target, args.GetValueOrDefault("iamRoleArn")),
            "migrate" => await Migration.MigrateAsync(target, args.GetValueOrDefault("tx") ?? "none"),
            "probe" => await Probe.RunAsync(target),
            "seed" => await Workload.SeedAsync(target),
            "book-burst" => await Workload.BookBurstAsync(target, Int("attempts", 100), Int("capacity", 20), Int("maxRetries", 50)),
            "book-steady" => await Workload.BookSteadyAsync(target, Int("count", 200)),
            "reads" => await Workload.ReadsAsync(target, Int("count", 100)),
            "room-overlap" => await Workload.RoomOverlapAsync(target, Int("attempts", 10)),
            "tenant-isolation" => await Workload.TenantIsolationAsync(target),
            "export" => await Workload.ExportAsync(target),
            "ping" => await Ping.RunAsync(target),
            _ => throw new ArgumentException($"Unknown scenario '{scenario}'.")
        };
    }
}

/// <summary>
/// Cold-start cost of the database path: building the data source (IAM
/// credentials), opening the first connection (TLS and token auth) and
/// the first query. The data source is cached for the life of the
/// process, as the real API would cache it across warm invocations.
/// </summary>
public static class Ping
{
    private static SpikeDataSource? cached;

    public static async Task<object> RunAsync(SpikeTarget target)
    {
        var cold = cached is null;
        var sw = Stopwatch.StartNew();
        cached ??= await target.OpenAsync(SpikeTarget.AppRole, 2);
        var createMs = sw.Elapsed.TotalMilliseconds;

        sw.Restart();
        await using var conn = await cached.DataSource.OpenConnectionAsync();
        var openMs = sw.Elapsed.TotalMilliseconds;

        sw.Restart();
        await Sql.ScalarAsync<int>(conn, "SELECT 1");
        var firstQueryMs = sw.Elapsed.TotalMilliseconds;

        sw.Restart();
        await Sql.ScalarAsync<long>(conn, "SELECT count(*) FROM scheduling.class_sessions WHERE organization_id = $1", Workload.StudioA);
        var secondQueryMs = sw.Elapsed.TotalMilliseconds;

        return new
        {
            scenario = "ping",
            engine = target.Engine.ToString(),
            cold,
            createDataSourceMs = Math.Round(createMs, 1),
            openConnectionMs = Math.Round(openMs, 1),
            firstQueryMs = Math.Round(firstQueryMs, 1),
            secondQueryMs = Math.Round(secondQueryMs, 1)
        };
    }
}

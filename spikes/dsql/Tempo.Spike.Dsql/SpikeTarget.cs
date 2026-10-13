using Amazon.AuroraDsql.Npgsql;
using Npgsql;

namespace Tempo.Spike.Dsql;

public enum Engine
{
    Postgres,
    Dsql
}

/// <summary>
/// Where one spike run points. The same scenarios run against a local
/// PostgreSQL 17 container (password auth) and against Aurora DSQL (IAM
/// tokens through the Aurora DSQL connector). In both engines the database
/// is <c>postgres</c>, because DSQL has exactly one database with that name.
/// </summary>
public sealed record SpikeTarget(Engine Engine, string Host, int Port, string? Region, string? Profile, string AdminUser, string LocalPassword)
{
    public const string MigratorRole = "tempo_migrator";
    public const string AppRole = "tempo_app";

    public static SpikeTarget FromEnvironment()
    {
        var engine = (Environment.GetEnvironmentVariable("SPIKE_ENGINE") ?? "postgres").ToLowerInvariant() switch
        {
            "dsql" => Engine.Dsql,
            "postgres" => Engine.Postgres,
            var other => throw new InvalidOperationException($"Unknown SPIKE_ENGINE '{other}'.")
        };

        return engine == Engine.Dsql
            ? new SpikeTarget(
                Engine.Dsql,
                Require("SPIKE_HOST"),
                5432,
                Environment.GetEnvironmentVariable("SPIKE_REGION") ?? Environment.GetEnvironmentVariable("AWS_REGION"),
                Environment.GetEnvironmentVariable("AWS_PROFILE"),
                "admin",
                "")
            : new SpikeTarget(
                Engine.Postgres,
                Environment.GetEnvironmentVariable("SPIKE_HOST") ?? "localhost",
                int.Parse(Environment.GetEnvironmentVariable("SPIKE_PORT") ?? "55432", System.Globalization.CultureInfo.InvariantCulture),
                null,
                null,
                "postgres",
                Environment.GetEnvironmentVariable("SPIKE_PG_PASSWORD") ?? "spike");
    }

    /// <summary>
    /// Opens a pooled data source for one database role. For DSQL the
    /// connector generates and refreshes IAM tokens; locally every role
    /// shares the container's spike password.
    /// </summary>
    public async Task<SpikeDataSource> OpenAsync(string user, int maxPoolSize = 10)
    {
        if (Engine == Engine.Dsql)
        {
            var dsql = await AuroraDsql.CreateDataSourceAsync(new DsqlConfig
            {
                Host = Host,
                Region = Region,
                Profile = Profile,
                User = user,
                Database = "postgres",
                ConfigureConnectionString = csb =>
                {
                    csb.MaxPoolSize = maxPoolSize;
                    csb.CommandTimeout = 120;
                }
            });
            return new SpikeDataSource(dsql.DataSource, dsql);
        }

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = Host,
            Port = Port,
            Database = "postgres",
            Username = user,
            Password = LocalPassword,
            SslMode = SslMode.Disable,
            MaxPoolSize = maxPoolSize,
            CommandTimeout = 120
        };
        var local = NpgsqlDataSource.Create(builder.ConnectionString);
        return new SpikeDataSource(local, local);
    }

    private static string Require(string name) =>
        Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException($"Missing environment variable '{name}'.");
}

/// <summary>An NpgsqlDataSource plus whatever owns it (the DSQL connector wrapper or the source itself).</summary>
public sealed class SpikeDataSource(NpgsqlDataSource dataSource, IAsyncDisposable owner) : IAsyncDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public ValueTask DisposeAsync() => owner.DisposeAsync();
}

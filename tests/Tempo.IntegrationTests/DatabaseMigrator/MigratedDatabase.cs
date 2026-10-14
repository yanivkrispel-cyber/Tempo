using DbUp.Engine.Output;
using Npgsql;
using Tempo.DatabaseMigrator;
using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// A fresh database on the fixture's container, migrated with every script,
/// and data sources that connect as the real runtime roles.
/// </summary>
public sealed class MigratedDatabase : IDataSourceProvider, IAsyncDisposable
{
    private readonly PostgresFixture postgres;
    private readonly (string Username, string Password) app;
    private readonly (string Username, string Password) platform;
    private readonly Dictionary<DatabaseRole, NpgsqlDataSource> dataSources = [];

    private MigratedDatabase(PostgresFixture postgres, string name, (string, string) app, (string, string) platform)
    {
        this.postgres = postgres;
        Name = name;
        this.app = app;
        this.platform = platform;
    }

    public string Name { get; }

    public static async Task<MigratedDatabase> CreateAsync(PostgresFixture postgres)
    {
        var name = await postgres.CreateDatabaseAsync();
        var app = ("tempo_app", Guid.NewGuid().ToString("N"));
        var platform = ("tempo_platform", Guid.NewGuid().ToString("N"));

        await MigrationRunner.RunAsync(
            new DatabaseEndpoint(postgres.Host, postgres.Port, name, SslMode.Disable),
            postgres.Master,
            app,
            platform,
            ("tempo_migrator", Guid.NewGuid().ToString("N")),
            new NullUpgradeLog(),
            CancellationToken.None);

        return new MigratedDatabase(postgres, name, app, platform);
    }

    /// <summary>
    /// Runs statements as the container's superuser, which bypasses row-level
    /// security. Positional parameters allow one statement per call.
    /// </summary>
    public async Task<object?> AsMasterAsync(string sql, params object?[] values)
    {
        await using var connection = postgres.ConnectAsMaster(Name);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var value in values)
        {
            command.Parameters.Add(new NpgsqlParameter { Value = value ?? DBNull.Value });
        }

        return await command.ExecuteScalarAsync();
    }

    public ValueTask<NpgsqlDataSource> GetAsync(DatabaseRole role, CancellationToken cancellationToken)
    {
        lock (dataSources)
        {
            if (!dataSources.TryGetValue(role, out var dataSource))
            {
                var (username, password) = role == DatabaseRole.Application ? app : platform;
                dataSource = NpgsqlDataSource.Create(new NpgsqlConnectionStringBuilder
                {
                    Host = postgres.Host,
                    Port = postgres.Port,
                    Database = Name,
                    Username = username,
                    Password = password,
                    SslMode = SslMode.Disable,
                    MaxPoolSize = 4
                }.ConnectionString);
                dataSources[role] = dataSource;
            }

            return ValueTask.FromResult(dataSource);
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var dataSource in dataSources.Values)
        {
            await dataSource.DisposeAsync();
        }
    }
}

/// <summary>Discards DbUp's log lines in tests.</summary>
public sealed class NullUpgradeLog : IUpgradeLog
{
    public void LogTrace(string format, params object[] args) { }

    public void LogDebug(string format, params object[] args) { }

    public void LogInformation(string format, params object[] args) { }

    public void LogWarning(string format, params object[] args) { }

    public void LogError(string format, params object[] args) { }

    public void LogError(Exception ex, string format, params object[] args) { }
}

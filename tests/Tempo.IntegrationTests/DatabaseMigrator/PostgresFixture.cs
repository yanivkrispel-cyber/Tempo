using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// One PostgreSQL 17 container for the migrator tests, the same major
/// version as the docker-compose database and Aurora (LLD section 10).
/// Each test creates its own database, so tests stay independent while
/// sharing one container.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgres:17-alpine").Build();

    public string Host => container.Hostname;

    public int Port => container.GetMappedPublicPort(PostgreSqlBuilder.PostgreSqlPort);

    /// <summary>The container's superuser, which plays the master (bootstrap) user.</summary>
    public (string Username, string Password) Master
    {
        get
        {
            var builder = new NpgsqlConnectionStringBuilder(container.GetConnectionString());
            return (builder.Username!, builder.Password!);
        }
    }

    public Task InitializeAsync() => container.StartAsync();

    public Task DisposeAsync() => container.DisposeAsync().AsTask();

    public async Task<string> CreateDatabaseAsync()
    {
        var name = $"tempo_{Guid.NewGuid():N}";
        await using var connection = new NpgsqlConnection(container.GetConnectionString());
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE {name}", connection);
        await command.ExecuteNonQueryAsync();
        return name;
    }

    /// <summary>
    /// A master user shaped like a managed service's (Aurora's rds_superuser,
    /// Neon's neondb_owner): CREATEROLE and owner of its database, but not a
    /// superuser.
    /// </summary>
    public async Task<(string Database, (string Username, string Password) Master)> CreateManagedMasterDatabaseAsync()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var master = ($"tempo_master_{suffix}", Guid.NewGuid().ToString("N"));
        var database = $"tempo_{suffix}";

        await using var connection = new NpgsqlConnection(container.GetConnectionString());
        await connection.OpenAsync();
        foreach (var sql in new[]
        {
            $"CREATE ROLE {master.Item1} LOGIN CREATEROLE PASSWORD '{master.Item2}'",
            $"CREATE DATABASE {database} OWNER {master.Item1}"
        })
        {
            await using var command = new NpgsqlCommand(sql, connection);
            await command.ExecuteNonQueryAsync();
        }

        return (database, master);
    }

    public NpgsqlConnection ConnectAsMaster(string database)
    {
        var builder = new NpgsqlConnectionStringBuilder(container.GetConnectionString()) { Database = database };
        return new NpgsqlConnection(builder.ConnectionString);
    }
}

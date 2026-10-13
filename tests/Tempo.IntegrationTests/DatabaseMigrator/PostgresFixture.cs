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

    public NpgsqlConnection ConnectAsMaster(string database)
    {
        var builder = new NpgsqlConnectionStringBuilder(container.GetConnectionString()) { Database = database };
        return new NpgsqlConnection(builder.ConnectionString);
    }
}

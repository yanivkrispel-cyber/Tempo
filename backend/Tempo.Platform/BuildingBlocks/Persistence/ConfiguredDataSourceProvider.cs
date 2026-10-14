using System.Collections.Concurrent;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Npgsql;

namespace Tempo.Platform.BuildingBlocks.Persistence;

/// <summary>
/// Builds the runtime data sources on first use, so code that never touches
/// the database (the health route, most worker messages) needs no database
/// settings. Shared by the API and the worker; each passes its own way of
/// reading settings (IConfiguration, environment variables).
///
/// Deployed: DATABASE_HOST (the Neon pooled endpoint), DATABASE_NAME and the
/// SSM parameter names DATABASE_APP_PASSWORD_PARAMETER and
/// DATABASE_PLATFORM_PASSWORD_PARAMETER (ADR-0015 amendment: names only, never
/// values). Each password is read from SSM once per cold start.
///
/// Locally and in tests: DATABASE_APP_CONNECTION_STRING and
/// DATABASE_PLATFORM_CONNECTION_STRING, used as given.
/// </summary>
public sealed class ConfiguredDataSourceProvider(Func<string, string?> setting) : IDataSourceProvider, IAsyncDisposable
{
    public const string ApplicationUsername = "tempo_app";
    public const string PlatformUsername = "tempo_platform";

    private readonly ConcurrentDictionary<DatabaseRole, Lazy<Task<NpgsqlDataSource>>> dataSources = new();

    public async ValueTask<NpgsqlDataSource> GetAsync(DatabaseRole role, CancellationToken cancellationToken) =>
        await dataSources.GetOrAdd(role, r => new Lazy<Task<NpgsqlDataSource>>(() => BuildAsync(r))).Value.WaitAsync(cancellationToken);

    public async ValueTask DisposeAsync()
    {
        foreach (var lazy in dataSources.Values.Where(l => l.IsValueCreated))
        {
            await (await lazy.Value).DisposeAsync();
        }
    }

    private async Task<NpgsqlDataSource> BuildAsync(DatabaseRole role)
    {
        var (connectionStringKey, passwordParameterKey, username) = role switch
        {
            DatabaseRole.Application => ("DATABASE_APP_CONNECTION_STRING", "DATABASE_APP_PASSWORD_PARAMETER", ApplicationUsername),
            DatabaseRole.Platform => ("DATABASE_PLATFORM_CONNECTION_STRING", "DATABASE_PLATFORM_PASSWORD_PARAMETER", PlatformUsername),
            _ => throw new ArgumentOutOfRangeException(nameof(role), role, null)
        };

        var connectionString = setting(connectionStringKey);
        if (string.IsNullOrEmpty(connectionString))
        {
            var host = Require("DATABASE_HOST");
            var passwordParameter = Require(passwordParameterKey);
            connectionString = new NpgsqlConnectionStringBuilder
            {
                Host = host,
                Database = Require("DATABASE_NAME"),
                Username = username,
                Password = await ReadSecureParameterAsync(passwordParameter),
                SslMode = SslMode.VerifyFull,
                // Lambda handles one request at a time; a few connections cover
                // the overlap while a previous response is still flushing.
                MaxPoolSize = 5,
                Timeout = 15
            }.ConnectionString;
        }

        return NpgsqlDataSource.Create(connectionString);
    }

    private string Require(string key) =>
        setting(key) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"The database is not configured: '{key}' is missing.");

    private static async Task<string> ReadSecureParameterAsync(string name)
    {
        using var ssm = new AmazonSimpleSystemsManagementClient();
        var response = await ssm.GetParameterAsync(new GetParameterRequest { Name = name, WithDecryption = true });
        return response.Parameter.Value;
    }
}

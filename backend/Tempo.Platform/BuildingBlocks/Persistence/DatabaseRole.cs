using Npgsql;

namespace Tempo.Platform.BuildingBlocks.Persistence;

/// <summary>The runtime database roles (docs/26 section 7.2). The migrator is not one of them.</summary>
public enum DatabaseRole
{
    /// <summary>`tempo_app`: account and tenant routes, filtered by row-level security.</summary>
    Application,

    /// <summary>`tempo_platform`: `/api/v1/platform/*` only.</summary>
    Platform
}

/// <summary>
/// One <see cref="NpgsqlDataSource"/> per runtime role. The host decides
/// where the connection details and passwords come from (SSM when deployed,
/// connection strings locally and in tests).
/// </summary>
public interface IDataSourceProvider
{
    ValueTask<NpgsqlDataSource> GetAsync(DatabaseRole role, CancellationToken cancellationToken);
}

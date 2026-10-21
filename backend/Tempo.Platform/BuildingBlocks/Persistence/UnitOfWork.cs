using Npgsql;
using Tempo.Platform.BuildingBlocks.Diagnostics;

namespace Tempo.Platform.BuildingBlocks.Persistence;

/// <summary>
/// One connection and one transaction, with the two row-level security values
/// set first (docs/26 section 7.3). They are set with is_local = true, so they
/// end with the transaction: the Neon pooler runs in transaction mode and may
/// hand the connection to another request afterwards. Disposing without
/// <see cref="CommitAsync"/> rolls back.
/// </summary>
public sealed class UnitOfWork : IAsyncDisposable
{
    private readonly NpgsqlConnection connection;
    private readonly NpgsqlTransaction transaction;
    private Dictionary<string, Func<CancellationToken, Task>>? afterCommit;

    private UnitOfWork(NpgsqlConnection connection, NpgsqlTransaction transaction)
    {
        this.connection = connection;
        this.transaction = transaction;
    }

    public static async Task<UnitOfWork> BeginAsync(
        IDataSourceProvider dataSources,
        DatabaseRole role,
        Guid? userAccountId,
        Guid? organizationId,
        CancellationToken cancellationToken)
    {
        var dataSource = await dataSources.GetAsync(role, cancellationToken);
        if (await StartAsync(dataSource, userAccountId, organizationId, retryIfBroken: true, cancellationToken) is { } unitOfWork)
        {
            return unitOfWork;
        }

        // The pool handed out a connection the server had already closed: a Lambda is frozen between requests, so the
        // pool can't prune while Neon suspends its compute (board #347, 2026-10-18). Nothing has run yet, so starting
        // again is safe; the other idle connections went stale together.
        dataSource.Clear();
        return (await StartAsync(dataSource, userAccountId, organizationId, retryIfBroken: false, cancellationToken))!;
    }

    /// <summary>
    /// Opens the connection, the transaction and the RLS values. With <paramref name="retryIfBroken"/>, a connection
    /// the server closed comes back as null instead of an error, so the caller can try once more.
    /// </summary>
    private static async Task<UnitOfWork?> StartAsync(
        NpgsqlDataSource dataSource, Guid? userAccountId, Guid? organizationId, bool retryIfBroken, CancellationToken cancellationToken)
    {
        NpgsqlConnection connection;
        using (ColdStart.Current.Measure("npgsql.open"))
        {
            // On a new environment: DNS, TLS and Neon waking its compute (P-1).
            connection = await dataSource.OpenConnectionAsync(cancellationToken);
        }

        try
        {
            var transaction = await connection.BeginTransactionAsync(cancellationToken);
            var unitOfWork = new UnitOfWork(connection, transaction);
            await unitOfWork.SetAsync(userAccountId, organizationId, cancellationToken);
            return unitOfWork;
        }
        catch (NpgsqlException) when (retryIfBroken && connection.State != System.Data.ConnectionState.Open)
        {
            await connection.DisposeAsync();
            return null;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    /// <summary>
    /// A command bound to this transaction. Positional parameters ($1, $2, ...)
    /// take the values in order; null becomes SQL NULL.
    /// </summary>
    public NpgsqlCommand Command(string sql, params object?[] parameters)
    {
        var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var value in parameters)
        {
            command.Parameters.Add(new NpgsqlParameter { Value = value ?? DBNull.Value });
        }

        return command;
    }

    /// <summary>
    /// Moves the transaction to a tenant it learned part-way: creating a
    /// studio, accepting an invitation, joining by link.
    /// </summary>
    public Task SetTenantAsync(Guid userAccountId, Guid organizationId, CancellationToken cancellationToken) =>
        SetAsync(userAccountId, organizationId, cancellationToken);

    public async Task CommitAsync(CancellationToken cancellationToken)
    {
        await transaction.CommitAsync(cancellationToken);
        foreach (var action in afterCommit?.Values ?? Enumerable.Empty<Func<CancellationToken, Task>>())
        {
            await action(cancellationToken);
        }
    }

    /// <summary>
    /// Runs <paramref name="action"/> once after a successful commit, however often it is registered under
    /// <paramref name="key"/>; never after a rollback. The action must not throw: the change is already committed.
    /// </summary>
    public void AfterCommit(string key, Func<CancellationToken, Task> action)
    {
        afterCommit ??= new Dictionary<string, Func<CancellationToken, Task>>(StringComparer.Ordinal);
        afterCommit.TryAdd(key, action);
    }

    public async ValueTask DisposeAsync()
    {
        await transaction.DisposeAsync();
        await connection.DisposeAsync();
    }

    private async Task SetAsync(Guid? userAccountId, Guid? organizationId, CancellationToken cancellationToken)
    {
        await using var command = Command(
            "SELECT set_config('app.user_account_id', $1, true), set_config('app.organization_id', $2, true)",
            userAccountId?.ToString() ?? string.Empty,
            organizationId?.ToString() ?? string.Empty);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}

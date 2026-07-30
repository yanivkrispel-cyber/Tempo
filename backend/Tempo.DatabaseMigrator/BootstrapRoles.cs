using System.Text.RegularExpressions;
using DbUp.Engine.Output;
using Npgsql;

namespace Tempo.DatabaseMigrator;

/// <summary>
/// Prepares the `application` and `migrator` Postgres roles (LLD section 12:
/// "Create or prepare database identities for: Master/bootstrap user,
/// Application user, Migrator user"). CDK provisions the Secrets Manager
/// secrets holding each role's password; only the master user can actually
/// issue `CREATE ROLE`, so this runs once, at the start of every migration,
/// using the master connection.
/// </summary>
public static partial class BootstrapRoles
{
    public static async Task RunAsync(
        string masterConnectionString,
        string databaseName,
        (string Username, string Password) applicationCredentials,
        (string Username, string Password) migratorCredentials,
        IUpgradeLog log,
        CancellationToken cancellationToken)
    {
        ValidateCredential(applicationCredentials);
        ValidateCredential(migratorCredentials);

        await using var connection = new NpgsqlConnection(masterConnectionString);
        await connection.OpenAsync(cancellationToken);

        await UpsertRoleAsync(connection, migratorCredentials, log, cancellationToken);
        await UpsertRoleAsync(connection, applicationCredentials, log, cancellationToken);

        var quotedDatabase = NpgsqlCommandBuilder.QuoteIdentifier(databaseName);

        await ExecuteAsync(
            connection,
            $"GRANT CREATE, CONNECT ON DATABASE {quotedDatabase} TO {NpgsqlCommandBuilder.QuoteIdentifier(migratorCredentials.Username)}",
            cancellationToken);
        await ExecuteAsync(
            connection,
            $"GRANT CONNECT ON DATABASE {quotedDatabase} TO {NpgsqlCommandBuilder.QuoteIdentifier(applicationCredentials.Username)}",
            cancellationToken);

        log.LogInformation(
            "Bootstrapped database roles '{0}' (migrator) and '{1}' (application)",
            migratorCredentials.Username,
            applicationCredentials.Username);
    }

    private static async Task UpsertRoleAsync(
        NpgsqlConnection connection,
        (string Username, string Password) credential,
        IUpgradeLog log,
        CancellationToken cancellationToken)
    {
        var quotedRole = NpgsqlCommandBuilder.QuoteIdentifier(credential.Username);

        // The password is interpolated directly because PostgreSQL DDL (CREATE
        // ROLE / ALTER ROLE) cannot be parameterized. This is only safe because
        // ValidateCredential() above enforces an alphanumeric-only charset,
        // matching how infrastructure/lib/data/database-stack.ts generates
        // these secrets (excludePunctuation: true).
        var sql = $"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '{credential.Username}') THEN
                    CREATE ROLE {quotedRole} LOGIN PASSWORD '{credential.Password}';
                ELSE
                    ALTER ROLE {quotedRole} WITH PASSWORD '{credential.Password}';
                END IF;
            END
            $$;
            """;

        await ExecuteAsync(connection, sql, cancellationToken);
        log.LogInformation("Ensured role '{0}' exists", credential.Username);
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void ValidateCredential((string Username, string Password) credential)
    {
        if (!UsernamePattern().IsMatch(credential.Username))
        {
            throw new InvalidOperationException(
                $"Refusing to bootstrap role with unexpected username format: '{credential.Username}'.");
        }

        if (!AlphanumericPattern().IsMatch(credential.Password))
        {
            throw new InvalidOperationException("Refusing to bootstrap role: password contains unexpected characters.");
        }
    }

    [GeneratedRegex("^[a-z_][a-z0-9_]*$")]
    private static partial Regex UsernamePattern();

    [GeneratedRegex("^[A-Za-z0-9]+$")]
    private static partial Regex AlphanumericPattern();
}

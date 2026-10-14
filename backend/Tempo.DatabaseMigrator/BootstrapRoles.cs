using System.Text.RegularExpressions;
using DbUp.Engine.Output;
using Npgsql;

namespace Tempo.DatabaseMigrator;

/// <summary>
/// Prepares the `application` and `migrator` Postgres roles (LLD section 12:
/// "Create or prepare database identities for: Master/bootstrap user,
/// Application user, Migrator user") and the `platform` schema that holds the
/// migration journal. Each role's password is an SSM SecureString parameter
/// that a person writes (ADR-0022); only the master user can issue `CREATE ROLE`,
/// so this runs once, at the start of every migration, using the master
/// connection. Every step is idempotent and checked from C#, with no
/// PL/pgSQL `DO` block, so the same bootstrap shape also fits engines without
/// procedural SQL (Aurora DSQL).
/// </summary>
public static partial class BootstrapRoles
{
    private static readonly NpgsqlCommandBuilder QuoteBuilder = new();

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

        var quotedDatabase = QuoteBuilder.QuoteIdentifier(databaseName);

        await ExecuteAsync(
            connection,
            $"GRANT CREATE, CONNECT ON DATABASE {quotedDatabase} TO {QuoteBuilder.QuoteIdentifier(migratorCredentials.Username)}",
            cancellationToken);
        await ExecuteAsync(
            connection,
            $"GRANT CONNECT ON DATABASE {quotedDatabase} TO {QuoteBuilder.QuoteIdentifier(applicationCredentials.Username)}",
            cancellationToken);

        // A managed master user (Aurora's rds_superuser, Neon's neondb_owner)
        // is not a superuser. From PostgreSQL 16 creating a role grants only
        // ADMIN on it, not SET, and AUTHORIZATION below needs SET. Granting
        // SET without INHERIT keeps the master's own privileges unchanged.
        await ExecuteAsync(
            connection,
            $"GRANT {QuoteBuilder.QuoteIdentifier(migratorCredentials.Username)} TO CURRENT_USER WITH INHERIT FALSE, SET TRUE",
            cancellationToken);

        // From PostgreSQL 15 an ordinary role cannot create objects in
        // `public`, so the migrator gets its own schema for the journal
        // (LLD section 10.5 lists `platform`).
        await ExecuteAsync(
            connection,
            $"CREATE SCHEMA IF NOT EXISTS {QuoteBuilder.QuoteIdentifier(MigrationJournal.SchemaName)} AUTHORIZATION {QuoteBuilder.QuoteIdentifier(migratorCredentials.Username)}",
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
        var quotedRole = QuoteBuilder.QuoteIdentifier(credential.Username);

        await using var exists = new NpgsqlCommand("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1", connection);
        exists.Parameters.Add(new NpgsqlParameter { Value = credential.Username });
        var roleExists = await exists.ExecuteScalarAsync(cancellationToken) is not null;

        // The password is interpolated directly because PostgreSQL DDL (CREATE
        // ROLE / ALTER ROLE) cannot be parameterized. This is only safe because
        // ValidateCredential() above enforces an alphanumeric-only charset,
        // which the documented way to generate these passwords produces
        // (infrastructure/README.md, "Database credentials").
        var sql = roleExists
            ? $"ALTER ROLE {quotedRole} WITH PASSWORD '{credential.Password}'"
            : $"CREATE ROLE {quotedRole} LOGIN PASSWORD '{credential.Password}'";

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

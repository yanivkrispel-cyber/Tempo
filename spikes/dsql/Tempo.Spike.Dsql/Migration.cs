using System.Data;
using System.Diagnostics;
using DbUp;
using DbUp.Engine;
using DbUp.Engine.Output;
using DbUp.Engine.Transactions;
using DbUp.Postgresql;
using DbUp.Support;
using Npgsql;

namespace Tempo.Spike.Dsql;

/// <summary>
/// DbUp journal that works on both PostgreSQL 17 and Aurora DSQL. DbUp's
/// built-in PostgresqlTableJournal creates its table with a <c>serial</c>
/// column, and DSQL rejects sequences without an explicit CACHE. This one
/// keys the journal by script name and lives in a schema the migrator owns
/// (the adapted fix for Phase 0 blocker 3).
/// </summary>
public sealed class SpikeJournal(Func<IConnectionManager> connectionManager, Func<IUpgradeLog> logger, string schema, string table)
    : TableJournal(connectionManager, logger, new PostgresqlObjectParser(), schema, table)
{
    protected override string CreateSchemaTableSql(string quotedPrimaryKeyName) =>
        $"CREATE TABLE IF NOT EXISTS {FqSchemaTableName} (script_name text NOT NULL, applied_at timestamptz NOT NULL, CONSTRAINT {quotedPrimaryKeyName} PRIMARY KEY (script_name))";

    protected override string GetInsertJournalEntrySql(string scriptName, string applied) =>
        $"INSERT INTO {FqSchemaTableName} (script_name, applied_at) VALUES ({scriptName}, {applied})";

    protected override string GetJournalEntriesSql() =>
        $"SELECT script_name FROM {FqSchemaTableName} ORDER BY script_name";

    protected override string DoesTableExistSql() =>
        $"SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = '{SchemaTableSchema}' AND tablename = '{UnquotedSchemaTableName}'";

    protected override IDbCommand GetInsertScriptCommand(Func<IDbCommand> dbCommandFactory, SqlScript script)
    {
        var command = dbCommandFactory();

        var name = command.CreateParameter();
        name.ParameterName = "scriptName";
        name.Value = script.Name;
        command.Parameters.Add(name);

        var applied = command.CreateParameter();
        applied.ParameterName = "applied";
        applied.Value = DateTime.UtcNow;
        command.Parameters.Add(applied);

        command.CommandText = GetInsertJournalEntrySql("@scriptName", "@applied");
        command.CommandType = CommandType.Text;
        return command;
    }
}

public sealed class ListLog : IUpgradeLog
{
    public List<string> Lines { get; } = [];

    public void LogTrace(string format, params object[] args) { }

    public void LogDebug(string format, params object[] args) { }

    public void LogInformation(string format, params object[] args) => Add("info", format, args);

    public void LogWarning(string format, params object[] args) => Add("warn", format, args);

    public void LogError(string format, params object[] args) => Add("error", format, args);

    public void LogError(Exception ex, string format, params object[] args) => Add("error", format + " :: " + ex.Message, args);

    private void Add(string level, string format, object[] args)
    {
        string text;
        try
        {
            text = string.Format(System.Globalization.CultureInfo.InvariantCulture, format, args);
        }
        catch (FormatException)
        {
            text = format;
        }

        Lines.Add($"{level}: {text}");
    }
}

public static class Migration
{
    private static readonly string[] Schemas = ["platform", "organizations", "scheduling"];

    /// <summary>
    /// One-time setup as the admin role: the two login roles, their IAM
    /// mapping (DSQL) or password (PostgreSQL), and the schemas the migrator
    /// owns. DSQL has no PL/pgSQL, so the existing BootstrapRoles' DO block
    /// is replaced by checks in C#. Every statement is its own transaction.
    /// </summary>
    public static async Task<object> BootstrapAsync(SpikeTarget target, string? iamRoleArn)
    {
        await using var admin = await target.OpenAsync(target.AdminUser, 1);
        await using var conn = await admin.DataSource.OpenConnectionAsync();
        var steps = new List<object>();

        async Task Step(string name, string sql)
        {
            var r = await Sql.TryAsync(() => Sql.ExecAsync(conn, sql));
            steps.Add(new { name, sql, r.Ok, r.SqlState, r.Message, ms = Math.Round(r.Ms, 1) });
        }

        foreach (var role in new[] { SpikeTarget.MigratorRole, SpikeTarget.AppRole })
        {
            var exists = await Sql.ScalarAsync<int?>(conn, "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1", role) == 1;
            if (!exists)
            {
                await Step($"create role {role}", target.Engine == Engine.Dsql
                    ? $"CREATE ROLE {role} WITH LOGIN"
                    : $"CREATE ROLE {role} WITH LOGIN PASSWORD '{target.LocalPassword}'");
            }
            else
            {
                steps.Add(new { name = $"create role {role}", skipped = "exists" });
            }

            if (target.Engine == Engine.Dsql)
            {
                if (string.IsNullOrEmpty(iamRoleArn))
                {
                    throw new InvalidOperationException("DSQL bootstrap needs iamRoleArn (the Lambda execution role).");
                }

                var mapped = await Sql.ScalarAsync<int?>(conn,
                    "SELECT 1 FROM sys.iam_pg_role_mappings WHERE pg_role_name = $1 AND arn = $2", role, iamRoleArn) == 1;
                if (!mapped)
                {
                    await Step($"iam grant {role}", $"AWS IAM GRANT {role} TO '{iamRoleArn}'");
                }
                else
                {
                    steps.Add(new { name = $"iam grant {role}", skipped = "mapped" });
                }
            }
        }

        foreach (var schema in Schemas)
        {
            var exists = await Sql.ScalarAsync<int?>(conn, "SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1", schema) == 1;
            if (exists)
            {
                steps.Add(new { name = $"schema {schema}", skipped = "exists" });
                continue;
            }

            // Preferred: the migrator owns the schema. Fallback: admin owns it and grants USAGE, CREATE.
            var r = await Sql.TryAsync(() => Sql.ExecAsync(conn, $"CREATE SCHEMA {schema} AUTHORIZATION {SpikeTarget.MigratorRole}"));
            steps.Add(new { name = $"schema {schema} authorization", r.Ok, r.SqlState, r.Message });
            if (!r.Ok)
            {
                await Step($"schema {schema}", $"CREATE SCHEMA {schema}");
                await Step($"grant schema {schema}", $"GRANT USAGE, CREATE ON SCHEMA {schema} TO {SpikeTarget.MigratorRole}");
            }
        }

        if (target.Engine == Engine.Dsql)
        {
            var mappings = await Sql.RowsAsync(conn, "SELECT pg_role_name, arn FROM sys.iam_pg_role_mappings ORDER BY pg_role_name");
            steps.Add(new { name = "iam mappings", rows = mappings.Select(r => $"{r[0]} -> {r[1]}") });
        }

        return new { scenario = "bootstrap", engine = target.Engine.ToString(), steps };
    }

    /// <summary>
    /// Runs the embedded migrations as the migrator role. transactionMode is
    /// "none" (each statement autocommits; scripts are idempotent) or
    /// "per-script" (DbUp's default, which wraps the script and the journal
    /// INSERT in one transaction).
    /// </summary>
    public static async Task<object> MigrateAsync(SpikeTarget target, string transactionMode)
    {
        await using var migrator = await target.OpenAsync(SpikeTarget.MigratorRole, 2);
        var log = new ListLog();
        var sw = Stopwatch.StartNew();

        var builder = DeployChanges.To
            .PostgresqlDatabase(new PostgresqlConnectionManager(migrator.DataSource))
            .WithScriptsEmbeddedInAssembly(typeof(Migration).Assembly, name => name.Contains(".Migrations.", StringComparison.Ordinal))
            .JournalTo((cm, lg) => new SpikeJournal(cm, lg, "platform", "schema_versions"))
            .WithVariable("async", target.Engine == Engine.Dsql ? "ASYNC" : "")
            .LogTo(log);

        builder = transactionMode == "per-script" ? builder.WithTransactionPerScript() : builder.WithoutTransaction();

        var result = builder.Build().PerformUpgrade();
        var migrateMs = sw.Elapsed.TotalMilliseconds;

        object? indexJobs = null;
        if (result.Successful && target.Engine == Engine.Dsql)
        {
            indexJobs = await WaitForIndexJobsAsync(migrator.DataSource);
        }

        return new
        {
            scenario = "migrate",
            engine = target.Engine.ToString(),
            transactionMode,
            successful = result.Successful,
            error = result.Error?.Message,
            errorScript = result.ErrorScript?.Name,
            applied = result.Scripts.Select(s => s.Name),
            ms = Math.Round(migrateMs, 1),
            indexJobs,
            log = log.Lines
        };
    }

    /// <summary>DSQL builds ASYNC indexes in the background; a migration run is only done when they are valid.</summary>
    private static async Task<object> WaitForIndexJobsAsync(NpgsqlDataSource dataSource)
    {
        await using var conn = await dataSource.OpenConnectionAsync();
        var sw = Stopwatch.StartNew();
        var jobs = await Sql.RowsAsync(conn, "SELECT job_id, status, object_name FROM sys.jobs WHERE status IN ('submitted', 'processing')");
        var waits = new List<object>();
        foreach (var job in jobs)
        {
            var r = await Sql.TryAsync(() => Sql.ScalarAsync<bool>(conn, "SELECT sys.wait_for_job($1)", job[0]!));
            waits.Add(new { jobId = job[0], objectName = job[2], r.Ok, r.SqlState, r.Message });
        }

        var invalid = await Sql.RowsAsync(conn,
            "SELECT c.relname FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid " +
            "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE NOT i.indisvalid AND n.nspname IN ('organizations', 'scheduling')");
        return new { pending = jobs.Count, waits, invalidIndexes = invalid.Select(r => r[0]), ms = Math.Round(sw.Elapsed.TotalMilliseconds, 1) };
    }
}

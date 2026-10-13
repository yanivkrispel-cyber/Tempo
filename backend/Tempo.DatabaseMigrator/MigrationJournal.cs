using System.Data;
using DbUp.Engine;
using DbUp.Engine.Output;
using DbUp.Engine.Transactions;
using DbUp.Postgresql;
using DbUp.Support;

namespace Tempo.DatabaseMigrator;

/// <summary>
/// DbUp journal stored as <c>platform.schema_versions</c>, a schema the
/// migrator role owns (LLD section 10.5). DbUp's default journal goes to
/// <c>public.schemaversions</c>, where PostgreSQL 15 and later give ordinary
/// roles no CREATE privilege, and its <c>serial</c> key would not run on
/// Aurora DSQL either. This journal is keyed by script name, so the same
/// table works on both engines.
/// </summary>
public sealed class MigrationJournal(Func<IConnectionManager> connectionManager, Func<IUpgradeLog> logger)
    : TableJournal(connectionManager, logger, new PostgresqlObjectParser(), SchemaName, TableName)
{
    public const string SchemaName = "platform";
    public const string TableName = "schema_versions";

    protected override string CreateSchemaTableSql(string quotedPrimaryKeyName) =>
        $"CREATE TABLE IF NOT EXISTS {FqSchemaTableName} (script_name text NOT NULL, applied_at timestamptz NOT NULL, CONSTRAINT {quotedPrimaryKeyName} PRIMARY KEY (script_name))";

    protected override string GetInsertJournalEntrySql(string scriptName, string applied) =>
        $"INSERT INTO {FqSchemaTableName} (script_name, applied_at) VALUES ({scriptName}, {applied})";

    protected override string GetJournalEntriesSql() =>
        $"SELECT script_name FROM {FqSchemaTableName} ORDER BY script_name";

    protected override string DoesTableExistSql() =>
        $"SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = '{SchemaName}' AND tablename = '{TableName}'";

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

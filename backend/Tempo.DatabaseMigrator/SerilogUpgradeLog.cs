using DbUp.Engine.Output;
using Serilog;

namespace Tempo.DatabaseMigrator;

/// <summary>Adapts DbUp's <see cref="IUpgradeLog"/> to the Serilog logger used by the rest of Tempo.</summary>
public sealed class SerilogUpgradeLog(ILogger logger) : IUpgradeLog
{
    public void LogTrace(string format, params object[] args) => logger.Verbose(format, args);

    public void LogDebug(string format, params object[] args) => logger.Debug(format, args);

    public void LogInformation(string format, params object[] args) => logger.Information(format, args);

    public void LogWarning(string format, params object[] args) => logger.Warning(format, args);

    public void LogError(string format, params object[] args) => logger.Error(format, args);

    public void LogError(Exception ex, string format, params object[] args) => logger.Error(ex, format, args);
}

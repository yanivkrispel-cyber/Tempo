using System.Diagnostics;
using System.Runtime.CompilerServices;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>Counts the database commands a service runs, to pin how many round trips a read takes.</summary>
internal static class QueryCounter
{
    /// <summary>Counts the commands Npgsql runs inside <paramref name="action"/>'s own async flow (other tests run in parallel).</summary>
    public static async Task<(T Result, int Queries)> CountAsync<T>(Func<Task<T>> action)
    {
        var counting = new AsyncLocal<StrongBox<int>?>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == "Npgsql",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            ActivityStarted = activity =>
            {
                if (counting.Value is { } box && activity.Kind == ActivityKind.Client)
                {
                    Interlocked.Increment(ref box.Value);
                }
            },
        };
        ActivitySource.AddActivityListener(listener);
        var queries = new StrongBox<int>(0);
        counting.Value = queries;
        var result = await action();
        counting.Value = null;
        return (result, queries.Value);
    }
}

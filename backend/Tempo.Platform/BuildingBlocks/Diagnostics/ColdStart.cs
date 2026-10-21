using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Tempo.Platform.BuildingBlocks.Diagnostics;

/// <summary>One timed step of a cold start: building the host, an SSM read, the first database connection.</summary>
public sealed record ColdStartPhase(string Name, DateTimeOffset Start, DateTimeOffset End)
{
    public double Milliseconds => (End - Start).TotalMilliseconds;
}

/// <summary>
/// The steps a new Lambda environment takes once, up to the end of its first request (board #445, P-1): where the
/// first request's 4 to 7 seconds go. Each phase is timed only until <see cref="Finish"/>; after that
/// <see cref="Measure"/> costs nothing, so the hot path stays as it was.
/// </summary>
public sealed class StartupTimeline
{
    /// <summary>A process that never finishes its timeline (the worker) stops recording here, so nothing grows.</summary>
    public const int MaxPhases = 64;

    private readonly ConcurrentQueue<ColdStartPhase> phases = new();
    private volatile bool finished;

    public bool Recording => !finished;

    /// <summary>Times the scope from now until it is disposed, while the timeline still records.</summary>
    public IDisposable Measure(string name) => finished ? NoScope.Instance : new Scope(this, name, DateTimeOffset.UtcNow);

    public void Record(string name, DateTimeOffset start, DateTimeOffset end)
    {
        if (finished)
        {
            return;
        }

        phases.Enqueue(new ColdStartPhase(name, start, end));
        if (phases.Count >= MaxPhases)
        {
            finished = true;
        }
    }

    /// <summary>Stops recording and hands back every phase once; a second call gets nothing.</summary>
    public IReadOnlyList<ColdStartPhase> Finish()
    {
        finished = true;
        var all = new List<ColdStartPhase>();
        while (phases.TryDequeue(out var phase))
        {
            all.Add(phase);
        }

        return [.. all.OrderBy(p => p.Start)];
    }

    private sealed class Scope(StartupTimeline timeline, string name, DateTimeOffset start) : IDisposable
    {
        public void Dispose() => timeline.Record(name, start, DateTimeOffset.UtcNow);
    }

    private sealed class NoScope : IDisposable
    {
        public static readonly NoScope Instance = new();

        public void Dispose()
        {
        }
    }
}

/// <summary>The process's one timeline. The API finishes it at the end of its first request.</summary>
public static class ColdStart
{
    public static StartupTimeline Current { get; } = new();

    /// <summary>When the process started, for the time the runtime took before <c>Main</c>.</summary>
    public static DateTimeOffset ProcessStart()
    {
        using var process = Process.GetCurrentProcess();
        return new DateTimeOffset(process.StartTime.ToUniversalTime(), TimeSpan.Zero);
    }
}

/// <summary>
/// Sends phases to X-Ray as subsegments of the current Lambda invocation, through the daemon's UDP port, without the
/// X-Ray SDK ($0, no new package). Only for a sampled trace; any failure is ignored, since this is diagnostics.
/// </summary>
public static class XRaySubsegments
{
    /// <summary>The documents for a trace header such as <c>Root=1-…;Parent=…;Sampled=1</c>; none if not sampled.</summary>
    public static IReadOnlyList<string> Documents(string? traceHeader, IEnumerable<ColdStartPhase> phases)
    {
        if (string.IsNullOrEmpty(traceHeader))
        {
            return [];
        }

        var parts = traceHeader.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(p => p.Split('=', 2))
            .Where(p => p.Length == 2)
            .ToDictionary(p => p[0], p => p[1], StringComparer.Ordinal);
        if (!parts.TryGetValue("Root", out var root) || !parts.TryGetValue("Parent", out var parent) ||
            !parts.TryGetValue("Sampled", out var sampled) || sampled != "1")
        {
            return [];
        }

        return [.. phases.Select(p => JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["name"] = p.Name,
            ["id"] = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8)),
            ["trace_id"] = root,
            ["parent_id"] = parent,
            ["start_time"] = p.Start.ToUnixTimeMilliseconds() / 1000.0,
            ["end_time"] = p.End.ToUnixTimeMilliseconds() / 1000.0,
            ["type"] = "subsegment",
            ["namespace"] = "local"
        }))];
    }

    public static void Send(IEnumerable<ColdStartPhase> phases)
    {
        try
        {
            var address = Environment.GetEnvironmentVariable("AWS_XRAY_DAEMON_ADDRESS");
            var documents = Documents(Environment.GetEnvironmentVariable("_X_AMZN_TRACE_ID"), phases);
            if (string.IsNullOrEmpty(address) || documents.Count == 0)
            {
                return;
            }

            // The address may list a UDP and a TCP endpoint ("udp:host:port tcp:host:port"); take the UDP one.
            var udp = address.Split(' ').FirstOrDefault(a => a.StartsWith("udp:", StringComparison.Ordinal))?[4..] ?? address.Split(' ')[0];
            var separator = udp.LastIndexOf(':');
            var host = udp[..separator];
            var port = int.Parse(udp[(separator + 1)..], CultureInfo.InvariantCulture);
            using var client = new UdpClient();
            foreach (var document in documents)
            {
                var bytes = Encoding.UTF8.GetBytes("{\"format\":\"json\",\"version\":1}\n" + document);
                client.Send(bytes, bytes.Length, host, port);
            }
        }
        catch (Exception exception) when (exception is SocketException or FormatException or ArgumentException or InvalidOperationException)
        {
            // Diagnostics only: a cold start never fails for its own measurement.
        }
    }
}

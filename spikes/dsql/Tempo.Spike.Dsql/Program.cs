using System.Text.Json;
using Tempo.Spike.Dsql;

// Local runner: dotnet run -- <scenario> [key=value ...] [out=path.json]
// SPIKE_ENGINE=postgres (default, local container on port 55432) or dsql
// (with SPIKE_HOST, SPIKE_REGION and AWS_PROFILE).

if (args.Length == 0)
{
    Console.Error.WriteLine("usage: <scenario> [key=value ...] [out=path.json]");
    return 2;
}

var options = args.Skip(1)
    .Select(a => a.Split('=', 2))
    .ToDictionary(p => p[0], p => p.Length > 1 ? p[1] : "", StringComparer.Ordinal);

var result = await Scenarios.RunAsync(args[0], options);
var json = JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
Console.WriteLine(json);

if (options.TryGetValue("out", out var outPath))
{
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
    await File.WriteAllTextAsync(outPath, json);
}

return 0;

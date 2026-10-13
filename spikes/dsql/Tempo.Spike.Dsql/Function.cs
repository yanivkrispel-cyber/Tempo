using System.Text.Json;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace Tempo.Spike.Dsql;

/// <summary>
/// Lambda entry point. The input is one flat JSON object, for example
/// {"scenario":"book-burst","attempts":"100","capacity":"20"}; every other
/// property is passed to the scenario as a string argument.
/// </summary>
public static class Function
{
    public static async Task<object> Handler(JsonElement input, ILambdaContext context)
    {
        var args = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var property in input.EnumerateObject())
        {
            args[property.Name] = property.Value.ValueKind == JsonValueKind.String
                ? property.Value.GetString()!
                : property.Value.GetRawText();
        }

        var scenario = args.GetValueOrDefault("scenario") ?? throw new ArgumentException("Missing 'scenario'.");
        context.Logger.LogInformation($"spike scenario {scenario}");
        return await Scenarios.RunAsync(scenario, args);
    }
}

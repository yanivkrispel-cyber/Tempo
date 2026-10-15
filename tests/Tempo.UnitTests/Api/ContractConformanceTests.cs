using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// The API and contracts/openapi/tempo-api.v1.yaml list the same operations: every mapped
/// endpoint's name is an `operationId` in the contract, and every `operationId` has an
/// endpoint. A route added on one side only fails here, before an app finds out.
/// Operations marked `x-tempo-planned: true` are agreed but not built yet: they must not have
/// an endpoint, so the PR that adds one also removes the mark.
/// </summary>
[Collection(ApiHostGroup.Name)]
public sealed partial class ContractConformanceTests
{
    [Fact]
    public void EveryContractOperation_HasAnEndpoint_AndEveryEndpointIsInTheContract()
    {
        using var api = new TestApi();
        var endpoints = api.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .Select(endpoint => endpoint.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName)
            .OfType<string>()
            .ToHashSet(StringComparer.Ordinal);

        var contract = File.ReadAllText(ContractPath());
        var planned = PlannedOperationId().Matches(contract)
            .Select(match => match.Groups[1].Value)
            .ToHashSet(StringComparer.Ordinal);
        var operations = OperationId().Matches(contract)
            .Select(match => match.Groups[1].Value)
            .Except(planned)
            .ToHashSet(StringComparer.Ordinal);

        operations.Should().NotBeEmpty();
        operations.Except(endpoints).Should().BeEmpty("every operation in the contract needs an endpoint with that name");
        endpoints.Except(operations).Except(planned).Should().BeEmpty("every named endpoint must be in the contract");
        endpoints.Intersect(planned).Should().BeEmpty("the PR that builds a planned operation removes its `x-tempo-planned` mark");
    }

    private static string ContractPath()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "contracts", "openapi", "tempo-api.v1.yaml");
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException("contracts/openapi/tempo-api.v1.yaml not found above the test output folder.");
    }

    [GeneratedRegex(@"^\s+operationId:\s*([A-Za-z0-9]+)\s*$", RegexOptions.Multiline)]
    private static partial Regex OperationId();

    // The mark sits on the line right after the operationId, as the contract writes it.
    [GeneratedRegex(@"^\s+operationId:\s*([A-Za-z0-9]+)[ \t]*\r?\n\s+x-tempo-planned:\s*true\s*$", RegexOptions.Multiline)]
    private static partial Regex PlannedOperationId();
}

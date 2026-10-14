using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// xUnit runs test classes in parallel, so several API hosts start in one
/// process at once. Program.cs sets Serilog's static logger; each host must
/// configure its own logger instead of freezing the shared one, or startup
/// fails with "The logger is already frozen".
/// </summary>
public sealed class ParallelHostStartupTests
{
    private const int HostCount = 8;

    [Fact]
    public async Task Hosts_StartedInParallel_AllServeRequests()
    {
        var factories = Enumerable.Range(0, HostCount).Select(_ => new WebApplicationFactory<Program>()).ToList();
        try
        {
            using var startTogether = new Barrier(HostCount);

            var responses = await Task.WhenAll(factories.Select(factory => Task.Run(() =>
            {
                startTogether.SignalAndWait(TimeSpan.FromSeconds(30));
                return factory.CreateClient().GetAsync("/api/v1/health");
            })));

            responses.Should().OnlyContain(response => response.StatusCode == HttpStatusCode.OK);
        }
        finally
        {
            foreach (var factory in factories)
            {
                await factory.DisposeAsync();
            }
        }
    }
}

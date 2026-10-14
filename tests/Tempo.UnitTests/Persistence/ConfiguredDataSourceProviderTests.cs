using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Persistence;
using Xunit;

namespace Tempo.UnitTests.Persistence;

public sealed class ConfiguredDataSourceProviderTests
{
    [Fact]
    public async Task AFailedBuild_IsRetriedOnTheNextCall()
    {
        var settings = new Dictionary<string, string?>();
        await using var provider = new ConfiguredDataSourceProvider(key => settings.GetValueOrDefault(key));

        var first = () => provider.GetAsync(DatabaseRole.Application, CancellationToken.None).AsTask();
        (await first.Should().ThrowAsync<InvalidOperationException>()).Which.Message.Should().Contain("DATABASE_HOST");

        settings["DATABASE_APP_CONNECTION_STRING"] = "Host=localhost;Database=tempo;Username=tempo_app;Password=x";
        var dataSource = await provider.GetAsync(DatabaseRole.Application, CancellationToken.None);

        dataSource.ConnectionString.Should().Contain("tempo_app");
    }

    [Fact]
    public async Task EachRole_GetsItsOwnDataSource_BuiltOnce()
    {
        var settings = new Dictionary<string, string?>
        {
            ["DATABASE_APP_CONNECTION_STRING"] = "Host=localhost;Username=tempo_app;Password=x",
            ["DATABASE_PLATFORM_CONNECTION_STRING"] = "Host=localhost;Username=tempo_platform;Password=y"
        };
        await using var provider = new ConfiguredDataSourceProvider(key => settings.GetValueOrDefault(key));

        var app = await provider.GetAsync(DatabaseRole.Application, CancellationToken.None);
        var platform = await provider.GetAsync(DatabaseRole.Platform, CancellationToken.None);

        (await provider.GetAsync(DatabaseRole.Application, CancellationToken.None)).Should().BeSameAs(app);
        platform.Should().NotBeSameAs(app);
        platform.ConnectionString.Should().Contain("tempo_platform");
    }
}

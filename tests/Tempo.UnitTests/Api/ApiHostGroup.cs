using Xunit;

namespace Tempo.UnitTests.Api;

/// <summary>
/// Test classes that start the API host run one after another. Program.cs
/// sets Serilog's static bootstrap logger, and two hosts starting in parallel
/// both try to freeze it ("The logger is already frozen"). This only keeps
/// the tests apart; the fix in Program.cs is a separate task.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class ApiHostGroup
{
    public const string Name = "API host";

    private ApiHostGroup()
    {
    }
}

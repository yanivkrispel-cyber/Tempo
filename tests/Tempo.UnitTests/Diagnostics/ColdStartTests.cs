using System.Text.Json;
using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Diagnostics;
using Xunit;

namespace Tempo.UnitTests.Diagnostics;

/// <summary>P-1 (board #445): the cold start's timeline records until the first request ends, then costs nothing.</summary>
public sealed class ColdStartTests
{
    [Fact]
    public void ATimeline_RecordsUntilFinished_InOrder_AndNothingAfter()
    {
        var timeline = new StartupTimeline();
        var t0 = DateTimeOffset.UtcNow;
        timeline.Record("b", t0.AddSeconds(-5), t0.AddSeconds(-1));
        timeline.Measure("a").Dispose();

        timeline.Record("first", t0.AddSeconds(-9), t0.AddSeconds(-8));
        var phases = timeline.Finish();
        phases.Select(p => p.Name).Should().Equal("first", "b", "a");
        phases[1].Milliseconds.Should().BeApproximately(4000, 0.001);
        timeline.Recording.Should().BeFalse();

        timeline.Record("late", t0, t0);
        timeline.Measure("late too").Dispose();

        timeline.Finish().Should().BeEmpty("a finished timeline hands nothing back twice and records nothing new");
    }

    [Fact]
    public void ATimelineNobodyFinishes_StopsAtItsCap()
    {
        var timeline = new StartupTimeline();
        for (var i = 0; i < StartupTimeline.MaxPhases + 10; i++)
        {
            timeline.Record("npgsql.open", DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        }

        timeline.Recording.Should().BeFalse("the worker never finishes its timeline, so it must not grow");
        timeline.Finish().Should().HaveCount(StartupTimeline.MaxPhases);
    }

    [Fact]
    public void XRayDocuments_AreSubsegmentsOfTheInvocation_OnlyWhenSampled()
    {
        var start = DateTimeOffset.FromUnixTimeMilliseconds(1_792_600_000_123);
        var phases = new[] { new ColdStartPhase("npgsql.open", start, start.AddMilliseconds(2500)) };
        const string Root = "1-5759e988-bd862e3fe1be46a994272793";

        var documents = XRaySubsegments.Documents($"Root={Root};Parent=53995c3f42cd8ad8;Sampled=1", phases);

        documents.Should().ContainSingle();
        var json = JsonSerializer.Deserialize<JsonElement>(documents[0]);
        json.GetProperty("name").GetString().Should().Be("npgsql.open");
        json.GetProperty("type").GetString().Should().Be("subsegment");
        json.GetProperty("trace_id").GetString().Should().Be(Root);
        json.GetProperty("parent_id").GetString().Should().Be("53995c3f42cd8ad8");
        json.GetProperty("id").GetString().Should().MatchRegex("^[0-9a-f]{16}$");
        json.GetProperty("start_time").GetDouble().Should().BeApproximately(1_792_600_000.123, 0.0005);
        json.GetProperty("end_time").GetDouble().Should().BeApproximately(1_792_600_002.623, 0.0005);

        XRaySubsegments.Documents($"Root={Root};Parent=53995c3f42cd8ad8;Sampled=0", phases).Should().BeEmpty();
        XRaySubsegments.Documents($"Root={Root};Sampled=1", phases).Should().BeEmpty("no parent to hang them on");
        XRaySubsegments.Documents(null, phases).Should().BeEmpty();
    }
}

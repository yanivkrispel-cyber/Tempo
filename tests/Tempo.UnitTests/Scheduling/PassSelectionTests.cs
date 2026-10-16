using FluentAssertions;
using Tempo.Platform.Modules.Scheduling.Domain;
using Xunit;

namespace Tempo.UnitTests.Scheduling;

/// <summary>docs/29 section 5.3: which pass a booking uses.</summary>
public sealed class PassSelectionTests
{
    private static readonly DateOnly Tuesday = new(2026, 10, 20);

    [Fact]
    public void TheOneEndingFirst_Wins_MembershipsBeforeCardsOnTheSameDay()
    {
        var card = Pass("card", "punch_card", ends: Tuesday.AddDays(10), entries: 10);
        var membership = Pass("membership", "membership", ends: Tuesday.AddDays(10));
        var later = Pass("later", "punch_card", ends: Tuesday.AddDays(60), entries: 10);

        PassSelection.Pick([later, card, membership], Tuesday, "pilates")!.Name.Should().Be("membership");
        PassSelection.Pick([later, card], Tuesday, "pilates")!.Name.Should().Be("card");
    }

    [Fact]
    public void ExpiredUsedUpAndOtherCategories_AreSkipped()
    {
        var expired = Pass("expired", "punch_card", ends: Tuesday.AddDays(-1), entries: 10);
        var usedUp = Pass("used up", "punch_card", ends: Tuesday.AddDays(5), entries: 10, used: 10);
        var yogaOnly = Pass("yoga", "membership", ends: Tuesday.AddDays(5), category: "yoga");
        var notYet = Pass("not yet", "membership", ends: Tuesday.AddDays(40)) with { StartsOn = Tuesday.AddDays(1) };

        PassSelection.Pick([expired, usedUp, yogaOnly, notYet], Tuesday, "pilates").Should().BeNull();
        PassSelection.Pick([yogaOnly], Tuesday, "yoga")!.Name.Should().Be("yoga");
    }

    [Fact]
    public void AWeeklyCap_CountsSundayToSaturday()
    {
        // Two held entries this week (Sunday 18.10 and Monday 19.10), one last week (Saturday 17.10).
        var capped = Pass("capped", "membership", ends: Tuesday.AddDays(20), cap: 2, held: [new(2026, 10, 18), new(2026, 10, 19), new(2026, 10, 17)]);

        PassSelection.Pick([capped], Tuesday, "pilates").Should().BeNull();
        PassSelection.Pick([capped], new DateOnly(2026, 10, 25), "pilates").Should().NotBeNull("Sunday starts a new week");
        PassSelection.WeekStart(Tuesday).Should().Be(new DateOnly(2026, 10, 18));
    }

    [Fact]
    public void AFrozenMembership_BooksNothingInsideTheFrozenDays()
    {
        // docs/29 section 16.4: frozen from Monday to Wednesday; Tuesday is out, Thursday is fine.
        var frozen = Pass("frozen", "membership", ends: Tuesday.AddDays(20), freezes: [(Tuesday.AddDays(-1), Tuesday.AddDays(1))]);
        var card = Pass("card", "punch_card", ends: Tuesday.AddDays(60), entries: 10);

        PassSelection.Pick([frozen], Tuesday, "pilates").Should().BeNull();
        PassSelection.Pick([frozen, card], Tuesday, "pilates")!.Name.Should().Be("card", "the card steps in while the membership is frozen");
        PassSelection.Pick([frozen], Tuesday.AddDays(2), "pilates").Should().NotBeNull();
    }

    private static PassCandidate Pass(string name, string kind, DateOnly ends, int? entries = null, int used = 0, int? cap = null, string? category = null, DateOnly[]? held = null, (DateOnly From, DateOnly To)[]? freezes = null) =>
        new(Guid.NewGuid(), name, kind, Tuesday.AddDays(-30), ends, entries, used, cap, category, held ?? [], freezes);
}

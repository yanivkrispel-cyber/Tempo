using FluentAssertions;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.Modules.People.Domain;
using Xunit;

namespace Tempo.UnitTests.People;

/// <summary>Contact values as stored (docs/27 section 4.2): phones in E.164 with Israel as the default region, emails lowercased.</summary>
public sealed class ContactValuesTests
{
    [Theory]
    [InlineData("050-2345678", "+972502345678")]
    [InlineData("0502345678", "+972502345678")]
    [InlineData("+972 50 234 5678", "+972502345678")]
    [InlineData("972502345678", "+972502345678")]
    [InlineData("03-1234567", "+97231234567")]
    [InlineData("+1 415 555 2671", "+14155552671")]
    public void Phone_IsStoredInE164(string input, string expected) =>
        ContactValues.Phone(input).Should().Be(expected);

    [Theory]
    [InlineData("12")]
    [InlineData("050-12")]
    [InlineData("not a phone")]
    public void Phone_RejectsWhatIsNotANumber(string input)
    {
        var parse = () => ContactValues.Phone(input);

        parse.Should().Throw<DomainRuleViolationException>().Which.Code.Should().Be("contact_point.invalid_phone");
    }

    [Fact]
    public void Email_IsTrimmedAndLowercased() =>
        ContactValues.Email("  Noa.Levi@Example.COM ").Should().Be("noa.levi@example.com");

    [Theory]
    [InlineData("noa")]
    [InlineData("noa@")]
    [InlineData("Noa Levi <noa@example.com>")]
    public void Email_RejectsWhatIsNotAnAddress(string input)
    {
        var parse = () => ContactValues.Email(input);

        parse.Should().Throw<DomainRuleViolationException>().Which.Code.Should().Be("contact_point.invalid_email");
    }
}

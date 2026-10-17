using System.Text;
using FluentAssertions;
using Tempo.Platform.Modules.Scheduling.Application;
using Xunit;

namespace Tempo.UnitTests.Scheduling;

/// <summary>docs/33 section 8: the check-in code's digits are RFC 4226 HOTP, checked against the RFC's own vectors.</summary>
public sealed class CheckinCodeTests
{
    private static readonly byte[] RfcSecret = Encoding.ASCII.GetBytes("12345678901234567890");

    [Theory]
    [InlineData(0, 755224)]
    [InlineData(1, 287082)]
    [InlineData(2, 359152)]
    [InlineData(3, 969429)]
    [InlineData(4, 338314)]
    [InlineData(5, 254676)]
    [InlineData(6, 287922)]
    [InlineData(7, 162583)]
    [InlineData(8, 399871)]
    [InlineData(9, 520489)]
    public void Hotp_MatchesRfc4226AppendixD(long counter, int expected) =>
        BookingService.Hotp(RfcSecret, counter).Should().Be(expected);
}

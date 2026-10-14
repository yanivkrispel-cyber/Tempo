using FluentAssertions;
using Npgsql;
using Tempo.DatabaseMigrator;
using Xunit;

namespace Tempo.IntegrationTests.DatabaseMigrator;

/// <summary>
/// The Neon owner URL in SSM (ADR-0022) is the only place the migrator Lambda
/// learns the host, the database and the master credential from.
/// </summary>
public sealed class DatabaseUrlTests
{
    [Fact]
    public void Parse_NeonUrl_ReturnsEndpointAndCredentialWithVerifyFull()
    {
        var (endpoint, credential) = DatabaseUrl.Parse(
            "postgresql://neondb_owner:abc123@ep-cool-darkness-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require");

        endpoint.Should().Be(new DatabaseEndpoint("ep-cool-darkness-123456.eu-central-1.aws.neon.tech", 5432, "neondb", SslMode.VerifyFull));
        credential.Should().Be(("neondb_owner", "abc123"));
    }

    [Fact]
    public void Parse_ExplicitPortAndEscapedPassword_AreKept()
    {
        var (endpoint, credential) = DatabaseUrl.Parse("postgres://owner:p%40ss%3Aword@db.example.com:6543/tempo", SslMode.Disable);

        endpoint.Should().Be(new DatabaseEndpoint("db.example.com", 6543, "tempo", SslMode.Disable));
        credential.Password.Should().Be("p@ss:word");
    }

    [Theory]
    [InlineData("host=db.example.com;username=owner")]
    [InlineData("https://owner:secret@db.example.com/tempo")]
    [InlineData("postgresql://owner@db.example.com/tempo")]
    [InlineData("postgresql://owner:secret@db.example.com/")]
    public void Parse_InvalidUrl_Throws(string url)
    {
        var parse = () => DatabaseUrl.Parse(url);

        parse.Should().Throw<FormatException>();
    }
}

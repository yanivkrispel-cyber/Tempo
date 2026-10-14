using Npgsql;

namespace Tempo.DatabaseMigrator;

/// <summary>
/// Parses a `postgresql://user:password@host[:port]/database?sslmode=...` URL,
/// the form Neon hands out (ADR-0022), into the endpoint and the credential
/// the migrator uses. Npgsql itself only accepts key=value connection strings.
/// The URL's own query string is ignored: TLS is always <see cref="SslMode.VerifyFull"/>
/// unless the caller asks for another mode.
/// </summary>
public static class DatabaseUrl
{
    private const int DefaultPort = 5432;

    public static (DatabaseEndpoint Endpoint, (string Username, string Password) Credential) Parse(
        string url,
        SslMode sslMode = SslMode.VerifyFull)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("postgresql" or "postgres"))
        {
            throw new FormatException("The database URL must be an absolute postgresql:// URL.");
        }

        var userInfo = uri.UserInfo.Split(':', 2);
        var databaseName = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
        if (userInfo.Length != 2 || userInfo[0].Length == 0 || userInfo[1].Length == 0 || databaseName.Length == 0)
        {
            throw new FormatException("The database URL must contain a user name, a password and a database name.");
        }

        var endpoint = new DatabaseEndpoint(uri.Host, uri.IsDefaultPort ? DefaultPort : uri.Port, databaseName, sslMode);
        return (endpoint, (Uri.UnescapeDataString(userInfo[0]), Uri.UnescapeDataString(userInfo[1])));
    }
}

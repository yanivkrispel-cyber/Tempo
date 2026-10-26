using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Tempo.Api.DependencyInjection;
using Tempo.Platform.Modules.Identity.Application;
using Xunit;
using Xunit.Abstractions;

namespace Tempo.IntegrationTests.Perf;

/// <summary>Runs only when `tools/scripts/perf-big-db.mjs run` hands it a Neon branch; skipped everywhere else (CI included).</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class PerfBigFactAttribute : FactAttribute
{
    public PerfBigFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PERF_BIG_APP")))
        {
            Skip = "Needs a perf-big Neon branch: node tools/scripts/perf-big-db.mjs run --branch perf-big-<date>.";
        }
    }
}

/// <summary>
/// A big studio's database (board #511, K4 / S-5) on its own Neon branch: one studio, 1,500 fictional members, 60
/// classes a week, a year of bookings and attendance, passes, inbox items and audit events. Fills once (a filled branch
/// is reused), resets pg_stat_statements, opens the reads of the 10 screens of the perf baseline three times through the
/// real API host (the member's as a member, the console's as the owner), and writes every query's time to
/// `tests/e2e/perf/big-db-<the branch date>.md`. S-5's line is 20 ms a query.
/// </summary>
public sealed class BigStudioPerfTests(ITestOutputHelper output) : IDisposable
{
    private const string CustomerIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Customers";
    private const string Slug = "perf-big-studio";

    private readonly RSA rsa = RSA.Create(2048);

    public void Dispose() => rsa.Dispose();

    [PerfBigFact]
    public async Task ABigStudio_EveryScreenQuery_IsTimed()
    {
        using var factory = Factory();
        var client = factory.CreateClient();
        var studioPath = await StudioAsync(client);
        await using var owner = NpgsqlDataSource.Create(Env("PERF_BIG_OWNER"));
        await ExecAsync(owner, "CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
        await ExecAsync(owner, "SELECT pg_stat_statements_reset()");

        var israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, israel).DateTime);
        var from = Iso(today.AddDays(-(int)today.DayOfWeek));
        var to = Iso(today.AddDays(6 - (int)today.DayOfWeek));
        var monthStart = Iso(new DateOnly(today.Year, today.Month, 1));
        var screens = new (string Screen, string Who, string[] Paths)[]
        {
            ("member home", "perf-big-member", ["", "/me/bookings?scope=upcoming&limit=100", "/me/progress", "/instructors", "/me/profile", $"/sessions?from={from}&to={to}", "/me/notifications?limit=30", "/me/passes"]),
            ("member book", "perf-big-member", ["", "/booking-policy", "/me/passes", $"/sessions?from={from}&to={to}"]),
            ("member bookings", "perf-big-member", ["", "/me/bookings?scope=upcoming&limit=100", "/me/bookings?scope=past&limit=20", "/me/notifications?limit=30"]),
            ("member profile", "perf-big-member", ["", "/me/buddies", "/me/health-declaration", "/me/passes", "/me/profile", "/me/progress"]),
            ("member inbox", "perf-big-member", ["", "/me/notifications?limit=30"]),
            ("console today", "perf-big-owner", ["", "/insights/activity?limit=12", "/insights/occupancy", "/insights/sales", "/insights/suggestions", $"/sessions?from={Iso(today)}&to={Iso(today)}"]),
            ("console schedule", "perf-big-owner", ["", $"/sessions?from={from}&to={to}"]),
            ("console people", "perf-big-owner", ["/people?status=active&limit=50", "/tags"]),
            ("console passes", "perf-big-owner", ["/pass-products"]),
            ("console reports", "perf-big-owner", ["", $"/reports/summary?from={monthStart}&to={Iso(today)}", "/reports/members-at-risk", "/reports/passes-ending", "/reports/sources?days=30"]),
        };

        var wall = new List<string>();
        for (var run = 0; run < 3; run++)
        {
            foreach (var (screen, who, paths) in screens)
            {
                foreach (var path in paths)
                {
                    var started = DateTimeOffset.UtcNow;
                    var response = await RawAsync(client, HttpMethod.Get, $"{studioPath}{path}", Customer(who));
                    var ms = (DateTimeOffset.UtcNow - started).TotalMilliseconds;
                    var text = await response.Content.ReadAsStringAsync();
                    response.StatusCode.Should().Be(HttpStatusCode.OK, $"GET {path} answered {text[..Math.Min(text.Length, 300)]}");
                    if (run == 2)
                    {
                        wall.Add($"| {screen} | `GET {(path.Length == 0 ? "/" : path.Split('?')[0])}` | {ms:0} | {text.Length / 1024.0:0.0} |");
                    }
                }
            }
        }

        var report = new StringBuilder();
        report.AppendLine(CultureInfo.InvariantCulture, $"# A big studio's database ({Env("PERF_BIG_BRANCH")}, {DateTimeOffset.UtcNow:yyyy-MM-dd HH:mm} UTC)");
        report.AppendLine();
        var countsAt = report.Length;
        report.AppendLine("## Every query behind the 10 screens (pg_stat_statements, 3 runs, slowest mean first)");
        report.AppendLine();
        report.AppendLine("| mean ms | max ms | calls | rows/call | shared hit | shared read | query |");
        report.AppendLine("|---:|---:|---:|---:|---:|---:|---|");
        await using (var stats = owner.CreateCommand(
            """
            SELECT mean_exec_time, max_exec_time, calls, rows::float / calls, shared_blks_hit, shared_blks_read, regexp_replace(query, '\s+', ' ', 'g')
            FROM pg_stat_statements
            WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND query !~* '^(SET|SHOW|BEGIN|COMMIT|ROLLBACK|DISCARD|SELECT set_config|SELECT pg_stat_statements)'
              AND query !~* 'pg_stat_statements|pg_catalog|information_schema|pg_type|pg_namespace|perf-big|slug = \$1'
            ORDER BY mean_exec_time DESC
            """))
        await using (var reader = await stats.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                var mean = reader.GetDouble(0);
                var query = reader.GetString(6).Replace("|", "\\|", StringComparison.Ordinal);
                report.AppendLine(CultureInfo.InvariantCulture,
                    $"| {(mean > 20 ? "**" : "")}{mean:0.00}{(mean > 20 ? "**" : "")} | {reader.GetDouble(1):0.00} | {reader.GetInt64(2)} | {reader.GetDouble(3):0.0} | {reader.GetInt64(4)} | {reader.GetInt64(5)} | `{(query.Length > 220 ? query[..220] + "…" : query)}` |");
            }
        }

        report.Insert(countsAt, await CountsAsync() + Environment.NewLine);
        report.AppendLine();
        report.AppendLine("## Each read through the API host on this laptop (third run; includes the round trips to Neon in Frankfurt)");
        report.AppendLine();
        report.AppendLine("| Screen | Read | ms | KB |");
        report.AppendLine("|---|---|---:|---:|");
        foreach (var line in wall)
        {
            report.AppendLine(line);
        }

        var file = Path.Combine(RepoRoot(), "tests", "e2e", "perf", $"big-db-{Env("PERF_BIG_BRANCH")["perf-big-".Length..]}.md");
        await File.WriteAllTextAsync(file, report.ToString());
        output.WriteLine(report.ToString());
    }

    /// <summary>The studio, its staff and one member through the API (so every row the API writes is there), then the bulk rows in SQL as the migrator.</summary>
    private async Task<string> StudioAsync(HttpClient client)
    {
        await using var migrator = NpgsqlDataSource.Create(Env("PERF_BIG_MIGRATOR"));
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer("perf-big-owner"));
        await using (var find = migrator.CreateCommand($"SELECT id FROM organizations.organizations WHERE slug = '{Slug}'"))
        {
            if (await find.ExecuteScalarAsync() is Guid existing)
            {
                output.WriteLine($"{Slug} is already filled; reusing it");
                return $"/api/v1/organizations/{existing}";
            }
        }

        var studio = await SendAsync(client, HttpMethod.Post, "/api/v1/organizations", Customer("perf-big-owner"), new { displayName = "סטודיו גדול לבדיקה", slug = Slug }, HttpStatusCode.Created);
        var studioId = studio.GetProperty("id").GetGuid();
        var studioPath = $"/api/v1/organizations/{studioId}";
        for (var i = 1; i <= 6; i++)
        {
            await JoinAsync(client, studioPath, $"perf-big-coach-{i}", "staff");
        }

        await JoinAsync(client, studioPath, "perf-big-member", "client");
        string[] rooms = ["חדר המכשירים", "חדר המזרנים", "החדר הגדול"];
        foreach (var room in rooms)
        {
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/rooms", Customer("perf-big-owner"), new { name = room, defaultCapacity = 12 }, HttpStatusCode.Created);
        }

        foreach (var (name, category) in new[] { ("פילאטיס מכשירים", "pilates"), ("פילאטיס מזרן", "pilates"), ("יוגה", "yoga"), ("ויניאסה", "yoga"), ("TRX", "fitness"), ("מתיחות", "fitness") })
        {
            await SendAsync(client, HttpMethod.Post, $"{studioPath}/class-types", Customer("perf-big-owner"), new { name, category, color = "rose", defaultMinutes = 50 }, HttpStatusCode.Created);
        }

        await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("perf-big-owner"), new { kind = "punch_card", name = "כרטיסיית 20", entries = 20, validDays = 120, priceAgorot = 120000 }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, $"{studioPath}/pass-products", Customer("perf-big-owner"), new { kind = "membership", name = "מנוי חודשי", validDays = 30, priceAgorot = 45000 }, HttpStatusCode.Created);

        await ExecAsync(migrator, FillSql, studioId);
        await ExecAsync(migrator, "ANALYZE people.people, scheduling.sessions, scheduling.bookings, scheduling.passes, scheduling.pass_uses, notifications.inbox_items, audit.audit_events");
        return studioPath;
    }

    /// <summary>`big-studio-fill.sql` next to this file: the bulk rows, with the studio's id in place of {0}.</summary>
    private static string FillSql => File.ReadAllText(Path.Combine(RepoRoot(), "tests", "Tempo.IntegrationTests", "Perf", "big-studio-fill.sql"));

    private static async Task<string> CountsAsync()
    {
        await using var migrator = NpgsqlDataSource.Create(Env("PERF_BIG_MIGRATOR"));
        var lines = new StringBuilder("| Table | Rows in the studio |\n|---|---:|\n");
        foreach (var table in new[] { "people.people", "scheduling.sessions", "scheduling.bookings", "scheduling.passes", "scheduling.pass_uses", "notifications.inbox_items", "audit.audit_events" })
        {
            await using var count = migrator.CreateCommand($"SELECT count(*) FROM {table} WHERE organization_id = (SELECT id FROM organizations.organizations WHERE slug = '{Slug}')");
            lines.Append(CultureInfo.InvariantCulture, $"| `{table}` | {await count.ExecuteScalarAsync()} |\n");
        }

        return lines.ToString();
    }

    private async Task JoinAsync(HttpClient client, string studioPath, string subject, string role)
    {
        var invitation = await SendAsync(client, HttpMethod.Post, $"{studioPath}/invitations", Customer("perf-big-owner"), new { email = $"{subject}@example.com", role }, HttpStatusCode.Created);
        await SendAsync(client, HttpMethod.Post, "/api/v1/session", Customer(subject));
        await SendAsync(client, HttpMethod.Post, "/api/v1/invitations/accept", Customer(subject), new { token = invitation.GetProperty("link").GetString()!.Split('#')[^1] });
    }

    private static async Task ExecAsync(NpgsqlDataSource dataSource, string sql, Guid? organizationId = null)
    {
        await using var command = dataSource.CreateCommand(organizationId is { } id ? sql.Replace("{0}", id.ToString(), StringComparison.Ordinal) : sql);
        command.CommandTimeout = 600;
        await command.ExecuteNonQueryAsync();
    }

    private static string Iso(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Env(string name) => Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException($"{name} is not set");

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Tempo.sln")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("Tempo.sln not found above the test binaries");
    }

    private WebApplicationFactory<Program> Factory()
    {
        var key = new RsaSecurityKey(rsa) { KeyId = "test-key" };
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("DATABASE_APP_CONNECTION_STRING", Env("PERF_BIG_APP"));
            builder.UseSetting("DATABASE_PLATFORM_CONNECTION_STRING", Env("PERF_BIG_PLATFORM"));
            builder.UseSetting("COGNITO_CLIENT_IDS", "customer-client");
            builder.UseSetting("COGNITO_OPERATOR_CLIENT_IDS", "operator-client");
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<CognitoOptions>(CognitoAuthentication.CustomerScheme, o => o.Issuer = CustomerIssuer);
                services.PostConfigure<JwtBearerOptions>(CognitoAuthentication.CustomerScheme, o =>
                {
                    o.Authority = null;
                    o.Configuration = new OpenIdConnectConfiguration { Issuer = CustomerIssuer };
                    o.Configuration.SigningKeys.Add(key);
                    o.TokenValidationParameters.ValidIssuer = CustomerIssuer;
                    o.TokenValidationParameters.IssuerSigningKey = key;
                });
                services.AddSingleton<ICognitoUserReader, FakeCognito>();
            });
        });
    }

    private string Customer(string subject)
    {
        var now = DateTime.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = CustomerIssuer,
            Subject = new ClaimsIdentity(
            [
                new Claim("sub", subject), new Claim("username", subject), new Claim("token_use", "access"),
                new Claim("client_id", "customer-client"),
                new Claim("auth_time", new DateTimeOffset(now.AddHours(-1)).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture))
            ]),
            NotBefore = now.AddMinutes(-1),
            IssuedAt = now.AddMinutes(-1),
            Expires = now.AddMinutes(30),
            SigningCredentials = new SigningCredentials(new RsaSecurityKey(rsa) { KeyId = "test-key" }, SecurityAlgorithms.RsaSha256)
        });
    }

    private static async Task<HttpResponseMessage> RawAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body, body.GetType());
        }

        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> SendAsync(HttpClient client, HttpMethod method, string path, string token, object? body = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await RawAsync(client, method, path, token, body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(expected, $"{method} {path} answered {text}");
        return text.Length == 0 ? default : JsonSerializer.Deserialize<JsonElement>(text);
    }

    /// <summary>Fictional addresses only (`@example.com`), as in every other API test.</summary>
    private sealed class FakeCognito : ICognitoUserReader
    {
        public Task<CognitoUser> GetAsync(string issuer, string username, CancellationToken cancellationToken) =>
            Task.FromResult(new CognitoUser($"{username}@example.com", true));
    }
}

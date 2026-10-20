using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Npgsql;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Audit;

namespace Tempo.Platform.Modules.Marketing;

/// <summary>A new studio link: where it leads (SL-1) is `TargetKind` and `TargetId`; a bare `SessionId` still means a session.</summary>
public sealed record NewMarketingLink(string? Channel, string? Template, Guid? SessionId, string? TargetKind = null, Guid? TargetId = null);

/// <summary>A link with its source code; <paramref name="Slug"/> lets the API write the members-app URL.</summary>
public sealed record MarketingLinkView(
    Guid Id,
    string Code,
    string Channel,
    string? Template,
    Guid? SessionId,
    string Slug,
    DateTimeOffset CreatedAt,
    string TargetKind = "schedule",
    Guid? TargetId = null,
    bool? ShowName = null);

public sealed record SourceCountsView(int Members, int Bookings, int Attended);

public sealed record ChannelSourceView(string Channel, SourceCountsView Counts);

public sealed record LinkSourceView(Guid LinkId, string Code, string Channel, string? Template, Guid? SessionId, DateTimeOffset CreatedAt, SourceCountsView Counts, string TargetKind = "schedule", Guid? TargetId = null);

public sealed record TargetSourceView(string Kind, SourceCountsView Counts);

public sealed record SourceReportView(int Days, IReadOnlyList<ChannelSourceView> ByChannel, IReadOnlyList<LinkSourceView> ByLink, IReadOnlyList<TargetSourceView>? ByTarget = null);

/// <summary>
/// Links that count (docs/37 section 6, MK4): every share gets its own code, and the report "מאיפה הגיעו ההרשמות"
/// counts new members (first touch) and bookings (last touch) per channel and per link, live under RLS. Owners and
/// admins make links for any class (`marketing.publish`); an instructor only for their own sessions
/// (`marketing.publish.own`, M-4).
/// </summary>
public interface IMarketingLinkService
{
    Task<MarketingLinkView> CreateAsync(TenantContext tenant, NewMarketingLink link, CancellationToken cancellationToken);

    Task<SourceReportView> ReportAsync(TenantContext tenant, int days, CancellationToken cancellationToken);
}

public sealed partial class MarketingLinkService(IDataSourceProvider dataSources) : IMarketingLinkService
{
    public static readonly IReadOnlyList<string> Channels = ["story", "whatsapp", "bio", "poster", "member_card", "referral", "other"];
    private const string Alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    private const int CodeLength = 8;

    public async Task<MarketingLinkView> CreateAsync(TenantContext tenant, NewMarketingLink link, CancellationToken cancellationToken)
    {
        var channel = link.Channel is not null && Channels.Contains(link.Channel)
            ? link.Channel
            : throw new DomainRuleViolationException(ViolationKind.Validation, "channel.invalid", "Choose where the link goes.", "channel");
        var template = string.IsNullOrWhiteSpace(link.Template) ? null : link.Template.Trim();
        if (template is not null && !TemplatePattern().IsMatch(template))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "template.invalid", "Unknown template.", "template");
        }

        var (kind, targetId) = Target(link);
        var sessionTarget = kind == "session" ? targetId : null;
        var everyClass = tenant.Has(Permissions.MarketingPublish);
        if (!everyClass && (!tenant.Has(Permissions.MarketingPublishOwn) || sessionTarget is null))
        {
            throw Denied();
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        if (kind == "offer")
        {
            // An offer link leads to a product this studio lists (SL-4); RLS keeps another studio's out.
            await using var offer = unitOfWork.Command(
                "SELECT 1 FROM scheduling.pass_products WHERE organization_id = $1 AND id = $2 AND public_listed AND status = 'active'",
                tenant.OrganizationId, targetId);
            if (await offer.ExecuteScalarAsync(cancellationToken) is null)
            {
                throw new DomainRuleViolationException(ViolationKind.Validation, "target.invalid", "Choose an offer the studio lists.", "target");
            }
        }

        if (sessionTarget is { } sessionId)
        {
            await using var session = unitOfWork.Command(
                "SELECT instructor_membership_id FROM scheduling.sessions WHERE organization_id = $1 AND id = $2",
                tenant.OrganizationId, sessionId);
            await using var reader = await session.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new DomainRuleViolationException(ViolationKind.NotFound, "session.not_found", "Class not found.");
            }

            var instructor = reader.IsDBNull(0) ? (Guid?)null : reader.GetGuid(0);
            if (!everyClass && instructor != tenant.MembershipId)
            {
                throw Denied();
            }
        }

        string slug;
        await using (var read = unitOfWork.Command("SELECT slug FROM organizations.organizations WHERE id = $1", tenant.OrganizationId))
        {
            slug = (string)(await read.ExecuteScalarAsync(cancellationToken))!;
        }

        var id = Guid.CreateVersion7();
        DateTimeOffset createdAt = default;
        string code = string.Empty;
        for (var attempt = 0; attempt < 5; attempt++)
        {
            code = NewCode();
            await using var savepoint = unitOfWork.Command("SAVEPOINT link_code");
            await savepoint.ExecuteNonQueryAsync(cancellationToken);
            try
            {
                await using var insert = unitOfWork.Command(
                    """
                    INSERT INTO marketing.links (organization_id, id, code, channel, template, session_id, target_kind, target_id, created_by, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $8, $9, $7, now())
                    RETURNING created_at
                    """,
                    tenant.OrganizationId, id, code, channel, template, sessionTarget, tenant.MembershipId, kind, targetId);
                insert.Parameters[5].NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid;
                insert.Parameters[8].NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid;
                await using var inserted = await insert.ExecuteReaderAsync(cancellationToken);
                await inserted.ReadAsync(cancellationToken);
                createdAt = inserted.GetFieldValue<DateTimeOffset>(0);
                break;
            }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && attempt < 4)
            {
                // Another link already has this code in the studio: try a new one.
                await using var rollback = unitOfWork.Command("ROLLBACK TO SAVEPOINT link_code");
                await rollback.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        // The channel and template only (docs/37 section 5); the code is not secret but says nothing either.
        await AuditWriter.WriteAsync(
            unitOfWork,
            new AuditEvent(tenant.OrganizationId, "user", tenant.UserAccountId, "marketing.link.created", "marketing_link", id, tenant.CorrelationId, new { channel, template, target = kind }),
            cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new MarketingLinkView(id, code, channel, template, sessionTarget, slug, createdAt, kind, targetId);
    }

    public static readonly IReadOnlyList<string> TargetKinds = ["session", "schedule", "offer", "prices"];

    /// <summary>
    /// SL-1: a session or an offer names its id, the week and the prices name none. Without a target a session id still
    /// means the session, and nothing means the week (one release).
    /// </summary>
    private static (string Kind, Guid? Id) Target(NewMarketingLink link)
    {
        if (link.TargetKind is null)
        {
            return link.SessionId is { } session ? ("session", session) : ("schedule", null);
        }

        var invalid = new DomainRuleViolationException(ViolationKind.Validation, "target.invalid", "Choose where the link leads.", "target");
        if (!TargetKinds.Contains(link.TargetKind))
        {
            throw invalid;
        }

        var needsId = link.TargetKind is "session" or "offer";
        return needsId == link.TargetId.HasValue ? (link.TargetKind, link.TargetId) : throw invalid;
    }

    public async Task<SourceReportView> ReportAsync(TenantContext tenant, int days, CancellationToken cancellationToken)
    {
        if (days is not (7 or 30))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "days.invalid", "Choose 7 or 30 days.", "days");
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using var read = unitOfWork.Command(
            """
            WITH since AS (SELECT now() - make_interval(days => $2) AS at),
            members AS (
                SELECT m.source_link_id AS link, count(*) AS n
                FROM organizations.memberships m, since
                WHERE m.organization_id = $1 AND m.source_link_id IS NOT NULL AND m.created_at >= since.at
                GROUP BY 1
            ),
            booked AS (
                SELECT b.source_link_id AS link, count(*) AS n, count(*) FILTER (WHERE b.status = 'attended') AS attended
                FROM scheduling.bookings b, since
                WHERE b.organization_id = $1 AND b.source_link_id IS NOT NULL AND b.created_at >= since.at
                GROUP BY 1
            )
            SELECT l.id, l.code, l.channel, l.template, l.session_id, l.created_at,
                   coalesce(m.n, 0), coalesce(b.n, 0), coalesce(b.attended, 0), l.target_kind, l.target_id
            FROM marketing.links l
            LEFT JOIN members m ON m.link = l.id
            LEFT JOIN booked b ON b.link = l.id
            WHERE l.organization_id = $1 AND (m.n IS NOT NULL OR b.n IS NOT NULL OR l.created_at >= (SELECT at FROM since))
            ORDER BY coalesce(m.n, 0) + coalesce(b.n, 0) DESC, l.created_at DESC
            LIMIT 200
            """,
            tenant.OrganizationId, days);
        var links = new List<LinkSourceView>();
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                string? template = reader.IsDBNull(3) ? null : reader.GetString(3);
                Guid? session = reader.IsDBNull(4) ? null : reader.GetGuid(4);
                links.Add(new LinkSourceView(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    template,
                    session,
                    reader.GetFieldValue<DateTimeOffset>(5),
                    new SourceCountsView((int)reader.GetInt64(6), (int)reader.GetInt64(7), (int)reader.GetInt64(8)),
                    reader.GetString(9),
                    reader.IsDBNull(10) ? null : reader.GetGuid(10)));
            }
        }

        var channels = links
            .GroupBy(l => l.Channel)
            .Select(g => new ChannelSourceView(g.Key, new SourceCountsView(g.Sum(l => l.Counts.Members), g.Sum(l => l.Counts.Bookings), g.Sum(l => l.Counts.Attended))))
            .OrderByDescending(c => c.Counts.Members + c.Counts.Bookings)
            .ThenBy(c => c.Channel, StringComparer.Ordinal)
            .ToList();
        var targets = links
            .GroupBy(l => l.TargetKind)
            .Select(g => new TargetSourceView(g.Key, new SourceCountsView(g.Sum(l => l.Counts.Members), g.Sum(l => l.Counts.Bookings), g.Sum(l => l.Counts.Attended))))
            .OrderByDescending(t => t.Counts.Members + t.Counts.Bookings)
            .ThenBy(t => t.Kind, StringComparer.Ordinal)
            .ToList();
        return new SourceReportView(days, channels, links, targets);
    }

    internal static string NewCode()
    {
        Span<char> code = stackalloc char[CodeLength];
        for (var i = 0; i < CodeLength; i++)
        {
            code[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        }

        return new string(code);
    }

    private static DomainRuleViolationException Denied() =>
        new(ViolationKind.Forbidden, "permission.denied", "You can share links for your own classes only.");

    [GeneratedRegex("^[a-z_]{1,32}$")]
    private static partial Regex TemplatePattern();

    private Task<UnitOfWork> BeginAsync(TenantContext tenant, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, tenant.UserAccountId, tenant.OrganizationId, cancellationToken);
}

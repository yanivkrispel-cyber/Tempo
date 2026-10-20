using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Organizations.Application;

namespace Tempo.Platform.Modules.Marketing;

/// <summary>A public studio's page (docs/37 section 4.2): its face, the intro offer and whether anyone may join.</summary>
public sealed record PublicStudioView(
    PublicStudio Studio,
    Guid? CoverMediaId,
    string TimeZone,
    string? IntroProductName,
    int? IntroPriceAgorot,
    bool HasIntroOffer,
    bool OpenJoin);

/// <summary>Where a public link leads (SL-1), and the inviter's first name for a member's own link while she shows it (SL-8).</summary>
public sealed record PublicLinkView(string TargetKind, Guid? TargetId, string? InviterFirstName);

/// <summary>The instructor as strangers may see them: only with their own consent (M-14).</summary>
public sealed record PublicInstructorView(string DisplayName, Guid? PhotoMediaId, string? Headline, string? InstagramHandle);

/// <summary>One session for strangers: availability is a bucket, never a count of people (M-10).</summary>
public sealed record PublicSessionView(
    Guid Id,
    DateTimeOffset StartsAt,
    int Minutes,
    string ClassTypeName,
    string ClassTypeCategory,
    string ClassTypeColor,
    Guid? CoverMediaId,
    string? RoomName,
    PublicInstructorView? Instructor,
    string Availability,
    int? SpotsLeft,
    bool WaitlistOpen,
    PublicEventView? Event = null,
    bool Past = false,
    IReadOnlyList<PublicSessionSummaryView>? Alternatives = null);

/// <summary>An upcoming session with room, offered when the one asked for is full, cancelled or past (SL-3).</summary>
public sealed record PublicSessionSummaryView(Guid Id, DateTimeOffset StartsAt, int Minutes, string ClassName, string? InstructorName, string Availability, int? SpotsLeft);

/// <summary>A product the studio lists publicly (SL-4, SL-5); prices are shown only, paid at the studio.</summary>
public sealed record PublicProductView(
    Guid Id,
    string Name,
    string Kind,
    int? PriceAgorot,
    int? Entries,
    int? PricePerClassAgorot,
    int ValidDays,
    bool NewcomersOnly,
    DateOnly? PublicUntil,
    string? Blurb);

/// <summary>An event's public face (docs/37 section 8.4): its title, description, price shown, and whether a pass is needed.</summary>
public sealed record PublicEventView(string Title, string? Description, int? PriceAgorot, bool PassRequired);

/// <summary>
/// The public read model of docs/37 section 4.2 (MK2). It selects only the studio's face and its sessions' shape:
/// no booking, roster, person or contact column is ever read here (a test asserts the JSON keys). Every query runs as
/// the app role inside the studio (RLS), with no user. A studio whose public page is off is not found.
/// </summary>
public interface IPublicStudioReads
{
    Task<PublicStudioView> GetStudioAsync(PublicStudio studio, CancellationToken cancellationToken);

    Task<IReadOnlyList<PublicSessionView>> ListSessionsAsync(PublicStudio studio, DateOnly? firstDay, DateOnly? lastDay, CancellationToken cancellationToken);

    Task<PublicSessionView> GetSessionAsync(PublicStudio studio, Guid sessionId, CancellationToken cancellationToken);

    /// <summary>SL-1, SL-8: one of the studio's links by its code; 404 `link.not_found` otherwise.</summary>
    Task<PublicLinkView> GetLinkAsync(PublicStudio studio, string code, CancellationToken cancellationToken);

    /// <summary>SL-5: listed, active products whose last day hasn't passed, offers first, then the owner's order.</summary>
    Task<IReadOnlyList<PublicProductView>> ListProductsAsync(PublicStudio studio, CancellationToken cancellationToken);

    /// <summary>SL-4: one listed product; null when it ended (archived or past its last day); 404 when not listed here.</summary>
    Task<PublicProductView?> GetProductAsync(PublicStudio studio, Guid productId, CancellationToken cancellationToken);
}

public sealed class PublicStudioReads(IDataSourceProvider dataSources, TimeProvider clock) : IPublicStudioReads
{
    /// <summary>`few` means this many places or fewer are left (M-10).</summary>
    public const int FewPlaces = 3;
    public const int MaxDays = 14;
    private const int MaxDaysAhead = 60;

    private const string SessionSelect =
        """
        SELECT s.id, s.starts_at, s.ends_at, ct.name, ct.category, ct.color, ct.cover_media_id, r.name,
               s.capacity, s.booked_count, s.status,
               sp.public_profile IS TRUE, pe.display_name, sp.photo_media_id, sp.headline, sp.instagram_handle,
               coalesce(bp.waitlist_enabled, true), coalesce(bp.waitlist_cutoff_hours, 2),
               s.event_title, s.event_description, s.event_price_agorot, s.pass_required
        FROM scheduling.sessions s
        JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
        LEFT JOIN scheduling.rooms r ON r.organization_id = s.organization_id AND r.id = s.room_id
        LEFT JOIN organizations.staff_profiles sp
               ON sp.organization_id = s.organization_id AND sp.membership_id = s.instructor_membership_id AND sp.public_profile
        LEFT JOIN people.people pe
               ON pe.organization_id = s.organization_id AND pe.membership_id = s.instructor_membership_id AND sp.public_profile
        LEFT JOIN scheduling.booking_policies bp ON bp.organization_id = s.organization_id
        WHERE s.organization_id = $1
        """;

    public async Task<PublicStudioView> GetStudioAsync(PublicStudio studio, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(studio, cancellationToken);
        await using var read = unitOfWork.Command(
            """
            SELECT pp.enabled, pp.open_join, o.cover_media_id, o.time_zone, pr.name, pr.price_agorot, pr.id IS NOT NULL
            FROM organizations.organizations o
            LEFT JOIN organizations.public_pages pp ON pp.organization_id = o.id
            LEFT JOIN scheduling.pass_products pr
                   ON pr.organization_id = o.id AND pr.id = pp.intro_product_id AND pr.status = 'active'
            WHERE o.id = $1
            """,
            studio.Id);
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken) || reader.IsDBNull(0) || !reader.GetBoolean(0))
        {
            throw NotFound();
        }

        Guid? cover = reader.IsDBNull(2) ? null : reader.GetGuid(2);
        string? introName = reader.IsDBNull(4) ? null : reader.GetString(4);
        int? introPrice = reader.IsDBNull(5) ? null : reader.GetInt32(5);
        return new PublicStudioView(studio, cover, reader.GetString(3), introName, introPrice, reader.GetBoolean(6), reader.GetBoolean(1));
    }

    public async Task<IReadOnlyList<PublicSessionView>> ListSessionsAsync(PublicStudio studio, DateOnly? firstDay, DateOnly? lastDay, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(studio, cancellationToken);
        var (enabled, timeZone) = await PageAsync(unitOfWork, studio, cancellationToken);
        if (!enabled)
        {
            throw NotFound();
        }

        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);
        var first = firstDay ?? today;
        var last = lastDay ?? first.AddDays(6);
        if (last < first || last.DayNumber - first.DayNumber >= MaxDays || first < today.AddDays(-1) || last > today.AddDays(MaxDaysAhead))
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "range.invalid", $"Ask for up to {MaxDays} days, from today on.", "from");
        }

        await using var read = unitOfWork.Command($"{SessionSelect} AND s.local_date BETWEEN $2 AND $3 ORDER BY s.starts_at, s.id", studio.Id, first, last);
        return await ReadSessionsAsync(read, cancellationToken);
    }

    public async Task<PublicSessionView> GetSessionAsync(PublicStudio studio, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(studio, cancellationToken);
        var (enabled, _) = await PageAsync(unitOfWork, studio, cancellationToken);
        if (!enabled)
        {
            throw NotFound();
        }

        var now = clock.GetUtcNow();
        await using var read = unitOfWork.Command(
            $"{SessionSelect} AND s.id = $2 AND s.starts_at BETWEEN $3 AND $4",
            studio.Id, sessionId, now.AddDays(-1), now.AddDays(MaxDaysAhead));
        var session = (await ReadSessionsAsync(read, cancellationToken)).SingleOrDefault()
            ?? throw new DomainRuleViolationException(ViolationKind.NotFound, "session.not_found", "Class not found.");
        await read.DisposeAsync();
        if (session.Availability is "open" or "few" && !session.Past)
        {
            return session;
        }

        // SL-3: the link from a story outlives its class. Up to three upcoming classes with room in the next 14 days,
        // the same class type first.
        await using var others = unitOfWork.Command(
            $"""
            {SessionSelect} AND s.status = 'scheduled' AND s.booked_count < s.capacity AND s.id <> $2
              AND s.starts_at > $3 AND s.starts_at < $4
            ORDER BY (s.class_type_id = (SELECT class_type_id FROM scheduling.sessions WHERE organization_id = $1 AND id = $2)) DESC, s.starts_at, s.id
            LIMIT 3
            """,
            studio.Id, sessionId, now, now.AddDays(MaxDays));
        var alternatives = (await ReadSessionsAsync(others, cancellationToken))
            .Select(a => new PublicSessionSummaryView(a.Id, a.StartsAt, a.Minutes, a.ClassTypeName, a.Instructor?.DisplayName, a.Availability, a.SpotsLeft))
            .ToList();
        return session with { Alternatives = alternatives };
    }

    public async Task<IReadOnlyList<PublicProductView>> ListProductsAsync(PublicStudio studio, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(studio, cancellationToken);
        var (enabled, timeZone) = await PageAsync(unitOfWork, studio, cancellationToken);
        if (!enabled)
        {
            throw NotFound();
        }

        await using var read = unitOfWork.Command(
            $"{ProductSelect} AND p.status = 'active' AND (p.public_until IS NULL OR p.public_until >= $2) ORDER BY p.newcomers_only DESC, p.public_order NULLS LAST, p.name, p.id",
            studio.Id, Today(timeZone));
        var products = new List<PublicProductView>();
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            products.Add(ProductOf(reader));
        }

        return products;
    }

    public async Task<PublicProductView?> GetProductAsync(PublicStudio studio, Guid productId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(studio, cancellationToken);
        var (enabled, timeZone) = await PageAsync(unitOfWork, studio, cancellationToken);
        if (!enabled)
        {
            throw NotFound();
        }

        await using var read = unitOfWork.Command($"{ProductSelect} AND p.id = $2", studio.Id, productId);
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new DomainRuleViolationException(ViolationKind.NotFound, "product.not_found", "There is no such offer here.");
        }

        var product = ProductOf(reader);
        var ended = reader.GetString(10) != "active" || (product.PublicUntil is { } until && until < Today(timeZone));
        return ended ? null : product;
    }

    private const string ProductSelect =
        """
        SELECT p.id, p.name, p.kind, p.price_agorot, p.entries, p.valid_days, p.newcomers_only, p.public_until, p.public_blurb, p.public_order, p.status
        FROM scheduling.pass_products p
        WHERE p.organization_id = $1 AND p.public_listed
        """;

    private static PublicProductView ProductOf(Npgsql.NpgsqlDataReader reader)
    {
        int? price = reader.IsDBNull(3) ? null : reader.GetInt32(3);
        int? entries = reader.IsDBNull(4) ? null : reader.GetInt32(4);
        int? perClass = price is { } total && entries is > 0 ? (int)Math.Round(total / (double)entries.Value, MidpointRounding.AwayFromZero) : null;
        return new PublicProductView(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetString(2),
            price,
            entries,
            perClass,
            reader.GetInt32(5),
            reader.GetBoolean(6),
            reader.IsDBNull(7) ? null : reader.GetFieldValue<DateOnly>(7),
            reader.IsDBNull(8) ? null : reader.GetString(8));
    }

    private DateOnly Today(string timeZone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);

    private async Task<List<PublicSessionView>> ReadSessionsAsync(Npgsql.NpgsqlCommand read, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var sessions = new List<PublicSessionView>();
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var startsAt = reader.GetFieldValue<DateTimeOffset>(1);
            var endsAt = reader.GetFieldValue<DateTimeOffset>(2);
            var capacity = reader.GetInt32(8);
            var left = Math.Max(0, capacity - reader.GetInt32(9));
            var cancelled = reader.GetString(10) == "cancelled";
            var availability = Availability(cancelled, left);
            var waitlistOpen = !cancelled && left == 0 && reader.GetBoolean(16) && now < startsAt.AddHours(-reader.GetInt32(17));
            PublicInstructorView? instructor = null;
            if (reader.GetBoolean(11) && !reader.IsDBNull(12))
            {
                Guid? photo = reader.IsDBNull(13) ? null : reader.GetGuid(13);
                string? headline = reader.IsDBNull(14) ? null : reader.GetString(14);
                string? handle = reader.IsDBNull(15) ? null : reader.GetString(15);
                instructor = new PublicInstructorView(reader.GetString(12), photo, headline, handle);
            }

            sessions.Add(new PublicSessionView(
                reader.GetGuid(0),
                startsAt,
                (int)(endsAt - startsAt).TotalMinutes,
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetGuid(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                instructor,
                availability,
                availability == "few" ? left : null,
                waitlistOpen,
                EventOf(reader),
                Past: now >= startsAt));
        }

        return sessions;
    }

    /// <summary>The event's columns (18 to 21 of the session select); null for a regular class.</summary>
    private static PublicEventView? EventOf(Npgsql.NpgsqlDataReader reader)
    {
        if (reader.IsDBNull(18))
        {
            return null;
        }

        string? description = reader.IsDBNull(19) ? null : reader.GetString(19);
        int? price = reader.IsDBNull(20) ? null : reader.GetInt32(20);
        return new PublicEventView(reader.GetString(18), description, price, reader.GetBoolean(21));
    }

    /// <summary>M-10: cancelled, full, few (3 or fewer left) or open.</summary>
    public static string Availability(bool cancelled, int placesLeft)
    {
        if (cancelled)
        {
            return "cancelled";
        }

        if (placesLeft == 0)
        {
            return "full";
        }

        return placesLeft <= FewPlaces ? "few" : "open";
    }

    public async Task<PublicLinkView> GetLinkAsync(PublicStudio studio, string code, CancellationToken cancellationToken)
    {
        var notFound = new DomainRuleViolationException(ViolationKind.NotFound, "link.not_found", "This link doesn't lead anywhere.");
        if (!SourceLinks.CodePattern().IsMatch(code))
        {
            throw notFound;
        }

        await using var unitOfWork = await BeginAsync(studio, cancellationToken);
        var (enabled, _) = await PageAsync(unitOfWork, studio, cancellationToken);
        if (!enabled)
        {
            throw NotFound();
        }

        // The inviter's first name only: the first word of the name the studio holds for her, never a surname, and only
        // on a member's own link while "להציג את השם שלי" is on (SL-8).
        await using var read = unitOfWork.Command(
            """
            SELECT l.target_kind, l.target_id,
                   CASE WHEN l.channel IN ('member_card', 'referral') AND l.show_name
                        THEN nullif(split_part(btrim(p.display_name), ' ', 1), '') END
            FROM marketing.links l
            LEFT JOIN people.people p ON p.organization_id = l.organization_id AND p.membership_id = l.created_by AND p.status = 'active'
            WHERE l.organization_id = $1 AND l.code = $2
            """,
            studio.Id, code);
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw notFound;
        }

        Guid? target = reader.IsDBNull(1) ? null : reader.GetGuid(1);
        string? inviter = reader.IsDBNull(2) ? null : reader.GetString(2);
        return new PublicLinkView(reader.GetString(0), target, inviter);
    }

    private static async Task<(bool Enabled, string TimeZone)> PageAsync(UnitOfWork unitOfWork, PublicStudio studio, CancellationToken cancellationToken)
    {
        await using var read = unitOfWork.Command(
            "SELECT coalesce(pp.enabled, false), o.time_zone FROM organizations.organizations o LEFT JOIN organizations.public_pages pp ON pp.organization_id = o.id WHERE o.id = $1",
            studio.Id);
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? (reader.GetBoolean(0), reader.GetString(1)) : (false, "Asia/Jerusalem");
    }

    private static DomainRuleViolationException NotFound() =>
        new(ViolationKind.NotFound, "studio.not_found", "There is no such studio.");

    private Task<UnitOfWork> BeginAsync(PublicStudio studio, CancellationToken cancellationToken) =>
        UnitOfWork.BeginAsync(dataSources, DatabaseRole.Application, null, studio.Id, cancellationToken);
}

using System.Globalization;
using System.Text;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Tenancy;

namespace Tempo.Platform.Modules.Scheduling.Application;

public sealed record CalendarFileView(string FileName, string Content);

/// <summary>"Add to calendar": one iCalendar file for the caller's own booking (docs/29 section 16.3).</summary>
public interface IBookingCalendarService
{
    Task<CalendarFileView> CalendarAsync(TenantContext tenant, Guid bookingId, CancellationToken cancellationToken);
}

public sealed partial class BookingService : IBookingCalendarService
{
    public async Task<CalendarFileView> CalendarAsync(TenantContext tenant, Guid bookingId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        // The caller's own booked or attended place only; anything else answers 404 (section 16.3).
        await using var command = unitOfWork.Command(
            """
            SELECT s.starts_at, s.ends_at, s.local_date, ct.name, o.display_name, r.name,
                   (SELECT ip.display_name FROM people.people ip WHERE ip.organization_id = s.organization_id AND ip.membership_id = s.instructor_membership_id)
            FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            JOIN organizations.organizations o ON o.id = b.organization_id
            LEFT JOIN scheduling.rooms r ON r.organization_id = s.organization_id AND r.id = s.room_id
            WHERE b.organization_id = $1 AND b.id = $2 AND p.membership_id = $3 AND b.status IN ('booked', 'attended')
            """,
            tenant.OrganizationId, bookingId, tenant.MembershipId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw BookingNotFound();
        }

        var startsAt = await reader.GetFieldValueAsync<DateTimeOffset>(0, cancellationToken);
        var endsAt = await reader.GetFieldValueAsync<DateTimeOffset>(1, cancellationToken);
        var localDate = await reader.GetFieldValueAsync<DateOnly>(2, cancellationToken);
        var className = reader.GetString(3);
        var studio = reader.GetString(4);
        var room = await reader.IsDBNullAsync(5, cancellationToken) ? null : reader.GetString(5);
        var instructor = await reader.IsDBNullAsync(6, cancellationToken) ? null : reader.GetString(6);

        var description = instructor is null ? $"שיעור {className} בסטודיו {studio}" : $"שיעור {className} עם {instructor.Split(' ')[0]} בסטודיו {studio}";
        var content = CalendarFile.Event(
            uid: $"{bookingId}@tempo",
            stamp: clock.GetUtcNow(),
            start: startsAt,
            end: endsAt,
            summary: className,
            location: room is null ? studio : $"{studio}, {room}",
            description: description);
        return new CalendarFileView($"tempo-{localDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.ics", content);
    }
}

/// <summary>A minimal RFC 5545 writer: one published event, UTC times, escaped text, lines folded at 75 octets.</summary>
public static class CalendarFile
{
    private const int MaxLineOctets = 75;

    public static string Event(string uid, DateTimeOffset stamp, DateTimeOffset start, DateTimeOffset end, string summary, string location, string description)
    {
        var lines = new[]
        {
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Tempo//Studio//HE",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            "BEGIN:VEVENT",
            $"UID:{Escape(uid)}",
            $"DTSTAMP:{Utc(stamp)}",
            $"DTSTART:{Utc(start)}",
            $"DTEND:{Utc(end)}",
            $"SUMMARY:{Escape(summary)}",
            $"LOCATION:{Escape(location)}",
            $"DESCRIPTION:{Escape(description)}",
            "END:VEVENT",
            "END:VCALENDAR"
        };
        var builder = new StringBuilder();
        foreach (var line in lines)
        {
            builder.Append(Fold(line)).Append("\r\n");
        }

        return builder.ToString();
    }

    /// <summary>
    /// Backslash, semicolon, comma and newline are escaped as RFC 5545 section 3.3.11 says; a lone CR is a newline
    /// too, and other control characters (bar tab) are dropped, so no name can start a new content line (#157).
    /// </summary>
    public static string Escape(string text) =>
        new string(text
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace(";", "\\;", StringComparison.Ordinal)
            .Replace(",", "\\,", StringComparison.Ordinal)
            .Replace("\r\n", "\\n", StringComparison.Ordinal)
            .Replace("\r", "\\n", StringComparison.Ordinal)
            .Replace("\n", "\\n", StringComparison.Ordinal)
            .Where(c => c == '\t' || !char.IsControl(c))
            .ToArray());

    /// <summary>
    /// A content line longer than 75 octets continues on the next line after a single space (section 3.1). The
    /// break never lands inside a UTF-8 sequence, so Hebrew text stays whole.
    /// </summary>
    public static string Fold(string line)
    {
        var builder = new StringBuilder();
        var octets = 0;
        foreach (var rune in line.EnumerateRunes())
        {
            var size = rune.Utf8SequenceLength;
            if (octets + size > MaxLineOctets)
            {
                builder.Append("\r\n ");
                octets = 1;
            }

            builder.Append(rune.ToString());
            octets += size;
        }

        return builder.ToString();
    }

    private static string Utc(DateTimeOffset at) => at.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
}

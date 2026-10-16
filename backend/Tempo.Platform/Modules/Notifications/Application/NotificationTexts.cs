using System.Globalization;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.Modules.Notifications.Domain;

namespace Tempo.Platform.Modules.Notifications.Application;

/// <summary>
/// The words of one notification (docs/30 section 13 step 7): the studio's active template for the kind and channel,
/// else the platform default, filled with the values read by the ids in the request's data. Used when the inbox
/// item is written and when its push goes out; works under the application and the platform role.
/// </summary>
public static class NotificationTexts
{
    /// <summary>Null for a kind without a template (`session.message`, `studio.announcement`).</summary>
    public static async Task<TemplateWords?> RenderAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid personId,
        string kind,
        IReadOnlyDictionary<string, Guid> data,
        string channel,
        CancellationToken cancellationToken)
    {
        if (TemplateCatalog.Find(kind) is not { } templated)
        {
            return null;
        }

        var words = await ActiveAsync(unitOfWork, organizationId, kind, TemplateCatalog.DefaultLocale, channel, cancellationToken)
            ?? TemplateCatalog.Default(templated, channel);
        var values = await ValuesAsync(unitOfWork, organizationId, personId, data, cancellationToken);
        return channel == TemplateCatalog.Push ? TemplateText.RenderPush(words, values) : TemplateText.RenderInbox(words, values);
    }

    /// <summary>The studio's active words for one channel, or null when it uses the default.</summary>
    public static async Task<TemplateWords?> ActiveAsync(UnitOfWork unitOfWork, Guid organizationId, string kind, string locale, string channel, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT coalesce(subject, ''), body FROM notifications.templates WHERE organization_id = $1 AND kind = $2 AND locale = $3 AND channel = $4 AND status = 'active'",
            organizationId, kind, locale, channel);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? new TemplateWords(reader.GetString(0), reader.GetString(1)) : null;
    }

    private static async Task<Dictionary<string, string>> ValuesAsync(
        UnitOfWork unitOfWork, Guid organizationId, Guid personId, IReadOnlyDictionary<string, Guid> data, CancellationToken cancellationToken)
    {
        var sessionId = data.TryGetValue("sessionId", out var session) ? session : (Guid?)null;
        var passId = data.TryGetValue("passId", out var pass) ? pass : (Guid?)null;
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["link.preferences"] = "/profile/notifications",
            ["link.session"] = sessionId is { } id ? $"/classes/{id}" : "/inbox"
        };

        await using var command = unitOfWork.Command(
            """
            SELECT o.display_name, o.time_zone, pe.display_name, ct.name, s.starts_at, r.name, p.entries - p.entries_used,
                   (SELECT f.ends_on FROM scheduling.pass_freezes f
                    WHERE f.organization_id = p.organization_id AND f.pass_id = p.id ORDER BY f.created_at DESC LIMIT 1)
            FROM organizations.organizations o
            LEFT JOIN people.people pe ON pe.organization_id = o.id AND pe.id = $2
            LEFT JOIN scheduling.sessions s ON s.organization_id = o.id AND s.id = $3
            LEFT JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            LEFT JOIN scheduling.rooms r ON r.organization_id = s.organization_id AND r.id = s.room_id
            LEFT JOIN scheduling.passes p ON p.organization_id = o.id AND p.id = $4
            WHERE o.id = $1
            """,
            organizationId, personId, sessionId, passId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return values;
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(reader.GetString(1));
        values["studio.name"] = reader.GetString(0);
        if (!await reader.IsDBNullAsync(2, cancellationToken))
        {
            values["person.firstName"] = reader.GetString(2).Trim().Split(' ', 2)[0];
        }

        if (!await reader.IsDBNullAsync(3, cancellationToken))
        {
            values["session.classTypeName"] = reader.GetString(3);
        }

        if (!await reader.IsDBNullAsync(4, cancellationToken))
        {
            values["session.startsLocal"] = TemplateDates.StartsLocal(await reader.GetFieldValueAsync<DateTimeOffset>(4, cancellationToken), zone);
        }

        if (!await reader.IsDBNullAsync(5, cancellationToken))
        {
            values["session.room"] = reader.GetString(5);
        }

        if (!await reader.IsDBNullAsync(6, cancellationToken))
        {
            values["pass.entriesLeft"] = reader.GetInt32(6).ToString(CultureInfo.InvariantCulture);
        }

        if (!await reader.IsDBNullAsync(7, cancellationToken))
        {
            values["pass.frozenUntil"] = TemplateDates.Day(await reader.GetFieldValueAsync<DateOnly>(7, cancellationToken));
        }

        return values;
    }
}

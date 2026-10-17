using System.Buffers.Binary;
using System.Security.Cryptography;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.People.Application;

namespace Tempo.Platform.Modules.Scheduling.Application;

/// <summary>The caller's check-in code now, and the class it would check them into (docs/33 section 8).</summary>
public sealed record CheckinCodeView(string Code, int ValidForSeconds, CheckinClassView? OpenClass, CheckinClassView? NextClass);

public sealed record CheckinClassView(Guid SessionId, Guid BookingId, string ClassName, DateTimeOffset StartsAt, DateTimeOffset OpensAt, string? SpotLabel);

/// <summary>What the scanner shows after a scan: who, which spot, and whether their declaration is in order.</summary>
public sealed record CheckinView(
    Guid BookingId,
    Guid SessionId,
    PersonRefView Person,
    Guid? AvatarMediaId,
    string? SpotLabel,
    string HealthStatus,
    bool AlreadyCheckedIn);

/// <summary>
/// Check-in at the door (docs/33 section 8, D19): the member's app shows a QR that changes every 30 seconds,
/// computed from a secret only the server and that person's code hold (HOTP, RFC 4226); staff scan it and the
/// booking of the class starting within 30 minutes (or running) is marked attended. A photo of a code is useless a
/// minute later.
/// </summary>
public interface ICheckinService
{
    Task<CheckinCodeView> MyCodeAsync(TenantContext tenant, CancellationToken cancellationToken);

    Task<CheckinView> CheckInAsync(TenantContext tenant, string? code, Guid? sessionId, CancellationToken cancellationToken);
}

public sealed partial class BookingService : ICheckinService
{
    private const int CheckinStepSeconds = 30;
    private const int MaxBadScansPerMinute = 5;
    private const string CheckinPrefix = "TCI1";

    public async Task<CheckinCodeView> MyCodeAsync(TenantContext tenant, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var person = await MyPersonIdAsync(unitOfWork, tenant, cancellationToken);
        var secret = await SecretAsync(unitOfWork, tenant.OrganizationId, person, create: true, cancellationToken);
        var now = clock.GetUtcNow();
        var step = now.ToUnixTimeSeconds() / CheckinStepSeconds;
        var code = $"{CheckinPrefix}.{person:N}.{Hotp(secret!, step):D6}";
        var classes = await CheckinClassesAsync(unitOfWork, tenant.OrganizationId, person, now, null, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        var open = classes.FirstOrDefault(c => c.OpensAt <= now);
        var next = classes.FirstOrDefault(c => c.OpensAt > now);
        return new CheckinCodeView(code, (int)(CheckinStepSeconds - (now.ToUnixTimeSeconds() % CheckinStepSeconds)), open, open is null ? next : null);
    }

    public async Task<CheckinView> CheckInAsync(TenantContext tenant, string? code, Guid? sessionId, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        var now = clock.GetUtcNow();
        await using (var attempts = unitOfWork.Command(
            "SELECT count(*)::int FROM people.checkin_attempts WHERE organization_id = $1 AND membership_id = $2 AND attempted_at > $3",
            tenant.OrganizationId, tenant.MembershipId, now.AddMinutes(-1)))
        {
            if ((int)(await attempts.ExecuteScalarAsync(cancellationToken))! >= MaxBadScansPerMinute)
            {
                throw new DomainRuleViolationException(ViolationKind.TooManyRequests, "checkin.too_many_attempts", "Too many invalid codes. Wait a minute.");
            }
        }

        var person = await VerifyCodeAsync(unitOfWork, tenant.OrganizationId, code, now, cancellationToken);
        if (person is null)
        {
            await RecordBadScanAsync(tenant, now, cancellationToken);
            throw new DomainRuleViolationException(ViolationKind.Validation, "checkin.invalid_code", "This code is not valid. Ask them to open it again.", "code");
        }

        var classes = await CheckinClassesAsync(unitOfWork, tenant.OrganizationId, person.Value, now, sessionId, cancellationToken);
        var open = classes.FirstOrDefault(c => c.OpensAt <= now);
        if (open is null)
        {
            throw classes.Count > 0
                ? Conflict("checkin.too_early", $"Check-in opens at {classes[0].OpensAt:HH:mm} UTC.")
                : Conflict("checkin.no_booking", "No class to check into now.");
        }

        // The same rule as marking attendance by hand: staff with attendance.mark, or this class's instructor.
        await StaffOrInstructorAsync(unitOfWork, tenant, open.SessionId, Permissions.AttendanceMark, cancellationToken);
        string status;
        Guid? avatar;
        string name;
        await using (var read = unitOfWork.Command(
            """
            SELECT b.status, p.avatar_media_id, p.display_name FROM scheduling.bookings b
            JOIN people.people p ON p.organization_id = b.organization_id AND p.id = b.person_id
            WHERE b.organization_id = $1 AND b.id = $2 FOR UPDATE OF b
            """,
            tenant.OrganizationId, open.BookingId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            status = reader.GetString(0);
            avatar = await reader.IsDBNullAsync(1, cancellationToken) ? null : reader.GetGuid(1);
            name = reader.GetString(2);
        }

        var already = status == "attended";
        if (!already)
        {
            await SetStatusAsync(unitOfWork, tenant.OrganizationId, open.BookingId, "attended", null, cancellationToken);
            await AuditAsync(unitOfWork, tenant, "booking.checked_in", open.BookingId, new { sessionId = open.SessionId, method = "code" }, cancellationToken);
        }

        var health = await HealthStatus.OfPersonAsync(unitOfWork, tenant.OrganizationId, person.Value, now, cancellationToken);
        await unitOfWork.CommitAsync(cancellationToken);
        return new CheckinView(open.BookingId, open.SessionId, new PersonRefView(person.Value, name), avatar, open.SpotLabel, health, already);
    }

    /// <summary>The person's live bookings whose check-in window (30 minutes before the start until the end) is open or still ahead today.</summary>
    private static async Task<List<CheckinClassView>> CheckinClassesAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, DateTimeOffset now, Guid? sessionId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            """
            SELECT s.id, b.id, ct.name, s.starts_at, rs.label
            FROM scheduling.bookings b
            JOIN scheduling.sessions s ON s.organization_id = b.organization_id AND s.id = b.session_id
            JOIN scheduling.class_types ct ON ct.organization_id = s.organization_id AND ct.id = s.class_type_id
            LEFT JOIN scheduling.room_spots rs ON rs.organization_id = b.organization_id AND rs.id = b.spot_id
            WHERE b.organization_id = $1 AND b.person_id = $2 AND b.status IN ('booked', 'attended')
              AND s.status = 'scheduled' AND s.ends_at > $3 AND s.starts_at < $3 + interval '18 hours'
              AND ($4::uuid IS NULL OR s.id = $4)
            ORDER BY s.starts_at
            LIMIT 5
            """,
            organizationId, personId, now, sessionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var classes = new List<CheckinClassView>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var startsAt = await reader.GetFieldValueAsync<DateTimeOffset>(3, cancellationToken);
            classes.Add(new CheckinClassView(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), startsAt, startsAt.Add(-AttendanceOpensBefore),
                await reader.IsDBNullAsync(4, cancellationToken) ? null : reader.GetString(4)));
        }

        return classes;
    }

    /// <summary>The person the code belongs to when its digits match this window or the one before; null otherwise.</summary>
    private static async Task<Guid?> VerifyCodeAsync(UnitOfWork unitOfWork, Guid organizationId, string? code, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var parts = (code ?? "").Trim().Split('.');
        if (parts.Length != 3 || parts[0] != CheckinPrefix || !Guid.TryParseExact(parts[1], "N", out var person) || parts[2].Length != 6 || !int.TryParse(parts[2], out var digits))
        {
            return null;
        }

        var secret = await SecretAsync(unitOfWork, organizationId, person, create: false, cancellationToken);
        if (secret is null)
        {
            return null;
        }

        var step = now.ToUnixTimeSeconds() / CheckinStepSeconds;
        return Hotp(secret, step) == digits || Hotp(secret, step - 1) == digits ? person : null;
    }

    private static async Task<byte[]?> SecretAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, bool create, CancellationToken cancellationToken)
    {
        await using (var read = unitOfWork.Command("SELECT checkin_secret FROM people.people WHERE organization_id = $1 AND id = $2 AND status = 'active'", organizationId, personId))
        {
            if (await read.ExecuteScalarAsync(cancellationToken) is byte[] existing)
            {
                return existing;
            }
        }

        if (!create)
        {
            return null;
        }

        var secret = RandomNumberGenerator.GetBytes(32);
        await using var write = unitOfWork.Command(
            "UPDATE people.people SET checkin_secret = coalesce(checkin_secret, $3) WHERE organization_id = $1 AND id = $2 RETURNING checkin_secret",
            organizationId, personId, secret);
        return await write.ExecuteScalarAsync(cancellationToken) as byte[];
    }

    /// <summary>RFC 4226 HOTP, six digits, HMAC-SHA1 (what TOTP apps use; the secret never leaves the server here).</summary>
    public static int Hotp(byte[] secret, long counter)
    {
        Span<byte> message = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(message, counter);
        Span<byte> hash = stackalloc byte[20];
#pragma warning disable CA5350 // HOTP is defined over HMAC-SHA1; the strength comes from the 256-bit secret and the 30-second window.
        HMACSHA1.HashData(secret, message, hash);
#pragma warning restore CA5350
        var offset = hash[^1] & 0x0F;
        var binary = ((hash[offset] & 0x7F) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        return binary % 1_000_000;
    }

    private async Task RecordBadScanAsync(TenantContext tenant, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);
        await using (var record = unitOfWork.Command(
            "INSERT INTO people.checkin_attempts (organization_id, membership_id, attempted_at) VALUES ($1, $2, $3)",
            tenant.OrganizationId, tenant.MembershipId, now))
        {
            await record.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var prune = unitOfWork.Command(
            "DELETE FROM people.checkin_attempts WHERE organization_id = $1 AND membership_id = $2 AND attempted_at < $3",
            tenant.OrganizationId, tenant.MembershipId, now.AddHours(-1)))
        {
            await prune.ExecuteNonQueryAsync(cancellationToken);
        }

        await unitOfWork.CommitAsync(cancellationToken);
    }
}

using System.Buffers.Binary;
using System.Security.Cryptography;
using Tempo.Platform.BuildingBlocks.Errors;
using Tempo.Platform.BuildingBlocks.Persistence;
using Tempo.Platform.BuildingBlocks.Tenancy;
using Tempo.Platform.Modules.Marketing;
using Tempo.Platform.Modules.People.Application;
using Tempo.Platform.Modules.People.Infrastructure;

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
    private const string CheckinPrefix = "TCI1";

    /// <summary>Invalid scans one staff member may make in a minute (#345).</summary>
    private const int MaxBadScansPerMinute = 5;

    /// <summary>Invalid scans of one person's code, by anyone, in an hour: a code can't be guessed by many scanners (#345).</summary>
    private const int MaxBadScansPerPersonPerHour = 10;

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
        var now = clock.GetUtcNow();

        // Who may scan is settled before the code is looked at (#345): a member never gets to test codes.
        await using (var check = await BeginAsync(tenant, cancellationToken))
        {
            await MayScanAsync(check, tenant, sessionId, now, cancellationToken);
        }

        // The attempt is recorded and committed before it is counted, so of many scans at once no more than the
        // limit get as far as the code (#345). A valid code forgets it again; what stays are the invalid ones.
        var attempt = await RecordAttemptAsync(tenant, ClaimedPerson(code), now, cancellationToken);

        Guid? person;
        await using (var verify = await BeginAsync(tenant, cancellationToken))
        {
            person = await VerifyCodeAsync(verify, tenant.OrganizationId, code, now, cancellationToken);
            if (person is null)
            {
                throw new DomainRuleViolationException(ViolationKind.Validation, "checkin.invalid_code", "This code is not valid. Ask them to open it again.", "code");
            }

            // A valid code is forgotten at once, whatever the check-in answers next (too early, no booking, ...).
            await using (var forget = verify.Command("DELETE FROM people.checkin_attempts WHERE organization_id = $1 AND id = $2", tenant.OrganizationId, attempt))
            {
                await forget.ExecuteNonQueryAsync(cancellationToken);
            }

            await verify.CommitAsync(cancellationToken);
        }

        await using var unitOfWork = await BeginAsync(tenant, cancellationToken);

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
            await AttendanceEffects.OnAttendedAsync(unitOfWork, tenant.OrganizationId, open.BookingId, tenant.UserAccountId, tenant.CorrelationId, cancellationToken);
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
    private async Task<Guid?> VerifyCodeAsync(UnitOfWork unitOfWork, Guid organizationId, string? code, DateTimeOffset now, CancellationToken cancellationToken)
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

    /// <summary>
    /// The person's 32-byte secret, kept encrypted with the health data key (#345, H-4). A plain secret from before
    /// migration 0031 still counts and is moved to the ciphertext here. With <paramref name="create"/>, a person
    /// without one gets a new one; two requests at once both end up with the one that was stored first.
    /// </summary>
    private async Task<byte[]?> SecretAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, bool create, CancellationToken cancellationToken)
    {
        byte[]? plain = null;
        byte[]? ciphertext = null;
        var keyVersion = 0;
        await using (var read = unitOfWork.Command(
            "SELECT checkin_secret, checkin_secret_ciphertext, checkin_secret_key_version FROM people.people WHERE organization_id = $1 AND id = $2 AND status = 'active'",
            organizationId, personId))
        await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }

            plain = await reader.IsDBNullAsync(0, cancellationToken) ? null : reader.GetFieldValue<byte[]>(0);
            ciphertext = await reader.IsDBNullAsync(1, cancellationToken) ? null : reader.GetFieldValue<byte[]>(1);
            keyVersion = await reader.IsDBNullAsync(2, cancellationToken) ? 0 : reader.GetInt32(2);
        }

        if (ciphertext is not null)
        {
            return await OpenSecretAsync(organizationId, personId, ciphertext, keyVersion, cancellationToken);
        }

        if (plain is null && !create)
        {
            return null;
        }

        // Store the old plain secret, or a new one, as ciphertext; only if the row still has no ciphertext.
        var secret = plain ?? RandomNumberGenerator.GetBytes(32);
        var keys = healthKeys ?? throw new InvalidOperationException("Check-in needs the health data keys (IHealthDataKeys).");
        var version = keys.CurrentVersion;
        var sealedSecret = HealthCipher.Encrypt(await keys.GetAsync(version, cancellationToken), Convert.ToBase64String(secret), SecretField(organizationId, personId, version));
        await using (var write = unitOfWork.Command(
            """
            UPDATE people.people SET checkin_secret_ciphertext = $3, checkin_secret_key_version = $4, checkin_secret = NULL
            WHERE organization_id = $1 AND id = $2 AND checkin_secret_ciphertext IS NULL
            """,
            organizationId, personId, sealedSecret, version))
        {
            if (await write.ExecuteNonQueryAsync(cancellationToken) == 1)
            {
                return secret;
            }
        }

        // Another request stored one first: use that.
        return await SecretAsync(unitOfWork, organizationId, personId, create: false, cancellationToken);
    }

    private async Task<byte[]> OpenSecretAsync(Guid organizationId, Guid personId, byte[] ciphertext, int keyVersion, CancellationToken cancellationToken)
    {
        var keys = healthKeys ?? throw new InvalidOperationException("Check-in needs the health data keys (IHealthDataKeys).");
        return Convert.FromBase64String(HealthCipher.Decrypt(await keys.GetAsync(keyVersion, cancellationToken), ciphertext, SecretField(organizationId, personId, keyVersion)));
    }

    /// <summary>The secret's place: the studio, the person (in the declaration's slot) and the key version.</summary>
    private static HealthField SecretField(Guid organizationId, Guid personId, int keyVersion) =>
        new(organizationId, personId, "people.checkin_secret", keyVersion);

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

    /// <summary>
    /// Staff with attendance.mark may scan; otherwise only an active instructor, of the given class or of one whose
    /// check-in is open now. The class the code opens is checked again with the same rule once it is known.
    /// </summary>
    private static async Task MayScanAsync(UnitOfWork unitOfWork, TenantContext tenant, Guid? sessionId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (tenant.Has(Permissions.AttendanceMark))
        {
            return;
        }

        if (sessionId is { } session)
        {
            await StaffOrInstructorAsync(unitOfWork, tenant, session, Permissions.AttendanceMark, cancellationToken);
            return;
        }

        await using var command = unitOfWork.Command(
            """
            SELECT EXISTS (
                SELECT 1 FROM scheduling.sessions s
                JOIN organizations.memberships m ON m.organization_id = s.organization_id AND m.id = s.instructor_membership_id
                WHERE s.organization_id = $1 AND s.instructor_membership_id = $2 AND m.status = 'active' AND m.role <> 'client'
                  AND s.status = 'scheduled' AND s.ends_at > $3 AND s.starts_at <= $4)
            """,
            tenant.OrganizationId, tenant.MembershipId, now, now.Add(AttendanceOpensBefore));
        if (await command.ExecuteScalarAsync(cancellationToken) is not true)
        {
            throw new DomainRuleViolationException(ViolationKind.Forbidden, "permission.denied", "Only staff or this class's instructor can do this.");
        }
    }

    /// <summary>The person a code says it belongs to, whether or not its digits are right; null when it isn't shaped like a code.</summary>
    private static Guid? ClaimedPerson(string? code)
    {
        var parts = (code ?? "").Trim().Split('.');
        return parts.Length == 3 && Guid.TryParseExact(parts[1], "N", out var person) ? person : null;
    }

    /// <summary>
    /// Writes the attempt in its own transaction, then counts the scanner's attempts in the last minute and the
    /// claimed person's in the last hour, this one included. Over either limit is 429; the attempt stays counted.
    /// </summary>
    private async Task<Guid> RecordAttemptAsync(TenantContext tenant, Guid? claimed, DateTimeOffset now, CancellationToken cancellationToken)
    {
        Guid id;
        await using (var unitOfWork = await BeginAsync(tenant, cancellationToken))
        {
            await using (var record = unitOfWork.Command(
                "INSERT INTO people.checkin_attempts (organization_id, membership_id, attempted_at, target_person_id) VALUES ($1, $2, $3, $4) RETURNING id",
                tenant.OrganizationId, tenant.MembershipId, now, claimed))
            {
                id = (Guid)(await record.ExecuteScalarAsync(cancellationToken))!;
            }

            await using (var prune = unitOfWork.Command(
                "DELETE FROM people.checkin_attempts WHERE organization_id = $1 AND (membership_id = $2 OR target_person_id = $3) AND attempted_at < $4",
                tenant.OrganizationId, tenant.MembershipId, claimed, now.AddHours(-1)))
            {
                await prune.ExecuteNonQueryAsync(cancellationToken);
            }

            await unitOfWork.CommitAsync(cancellationToken);
        }

        int byScanner;
        int byPerson;
        await using (var unitOfWork = await BeginAsync(tenant, cancellationToken))
        {
            await using var count = unitOfWork.Command(
                """
                SELECT count(*) FILTER (WHERE membership_id = $2 AND attempted_at > $4)::int,
                       count(*) FILTER (WHERE target_person_id = $3 AND attempted_at > $5)::int
                FROM people.checkin_attempts
                WHERE organization_id = $1 AND (membership_id = $2 OR target_person_id = $3)
                """,
                tenant.OrganizationId, tenant.MembershipId, claimed, now.AddMinutes(-1), now.AddHours(-1));
            await using var reader = await count.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            byScanner = reader.GetInt32(0);
            byPerson = reader.GetInt32(1);
        }

        if (byScanner > MaxBadScansPerMinute || byPerson > MaxBadScansPerPersonPerHour)
        {
            throw new DomainRuleViolationException(ViolationKind.TooManyRequests, "checkin.too_many_attempts", "Too many invalid codes. Wait a minute.");
        }

        return id;
    }
}

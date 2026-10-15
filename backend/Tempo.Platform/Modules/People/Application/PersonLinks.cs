using Tempo.Platform.BuildingBlocks.Persistence;

namespace Tempo.Platform.Modules.People.Application;

/// <summary>
/// Gives a new membership its person record (docs/27 section 4.5), in the same
/// transaction that creates the membership:
/// <list type="number">
///   <item>the account's own record in this studio, if it has one (they left and came back);</item>
///   <item>otherwise a record with no login whose email contact is the account's
///   verified email (staff recorded them as a walk-in), which is linked and its
///   email marked verified;</item>
///   <item>otherwise a new record from the account's name and email.</item>
/// </list>
/// A record merged into another or anonymized is never reused.
/// </summary>
public static class PersonLinks
{
    public static async Task<Guid> EnsureForMembershipAsync(
        UnitOfWork unitOfWork,
        Guid organizationId,
        Guid membershipId,
        Guid userAccountId,
        string source,
        CancellationToken cancellationToken,
        Guid? invitedPersonId = null)
    {
        string email;
        string displayName;
        bool emailVerified;
        await using (var account = unitOfWork.Command(
            "SELECT lower(email), coalesce(nullif(btrim(display_name), ''), split_part(email, '@', 1)), email_verified FROM identity.user_accounts WHERE id = $1",
            userAccountId))
        await using (var reader = await account.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                throw new InvalidOperationException("The account behind a new membership is not visible to its own transaction.");
            }

            email = reader.GetString(0);
            displayName = reader.GetString(1);
            emailVerified = reader.GetBoolean(2);
        }

        var existing = await FindAsync(
            unitOfWork,
            "SELECT id FROM people.people WHERE organization_id = $1 AND user_account_id = $2 AND status IN ('active', 'archived')",
            organizationId,
            userAccountId,
            cancellationToken);

        // An invitation for a recorded person links that record, if it is still live and has no login.
        existing ??= invitedPersonId is { } invited
            ? await FindAsync(
                unitOfWork,
                "SELECT id FROM people.people WHERE organization_id = $1 AND id = $2 AND user_account_id IS NULL AND status IN ('active', 'archived')",
                organizationId,
                invited,
                cancellationToken)
            : null;

        // Only a verified email may claim a walk-in's record, or anyone could sign up with someone else's address.
        existing ??= emailVerified
            ? await FindAsync(
                unitOfWork,
                """
                SELECT p.id
                FROM people.people p
                JOIN people.contact_points c ON c.organization_id = p.organization_id AND c.person_id = p.id AND c.type = 'email' AND c.value = $2
                WHERE p.organization_id = $1 AND p.user_account_id IS NULL AND p.status IN ('active', 'archived')
                ORDER BY p.created_at
                LIMIT 1
                """,
                organizationId,
                email,
                cancellationToken)
            : null;

        if (existing is { } personId)
        {
            await using (var link = unitOfWork.Command(
                """
                UPDATE people.people
                SET user_account_id = $3, membership_id = $4, status = 'active', updated_at = now(), version = version + 1
                WHERE organization_id = $1 AND id = $2
                """,
                organizationId,
                personId,
                userAccountId,
                membershipId))
            {
                await link.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var verify = unitOfWork.Command(
                "UPDATE people.contact_points SET verified = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND person_id = $2 AND type = 'email' AND value = $3",
                organizationId,
                personId,
                email,
                emailVerified))
            {
                if (await verify.ExecuteNonQueryAsync(cancellationToken) == 0)
                {
                    await PeopleService.InsertContactAsync(unitOfWork, organizationId, personId, "email", email, isPrimary: !await HasPrimaryEmailAsync(unitOfWork, organizationId, personId, cancellationToken), cancellationToken, verified: emailVerified);
                }
            }

            return personId;
        }

        var created = Guid.CreateVersion7();
        await using (var insert = unitOfWork.Command(
            """
            INSERT INTO people.people (organization_id, id, display_name, status, user_account_id, membership_id, source, created_at, updated_at)
            VALUES ($1, $2, $3, 'active', $4, $5, $6, now(), now())
            """,
            organizationId,
            created,
            displayName,
            userAccountId,
            membershipId,
            source))
        {
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await PeopleService.InsertContactAsync(unitOfWork, organizationId, created, "email", email, isPrimary: true, cancellationToken, verified: emailVerified);
        await PeopleService.FlagDuplicatesAsync(unitOfWork, organizationId, created, cancellationToken);
        return created;
    }

    /// <summary>A removed membership leaves its person record in place, unlinked from the membership (section 4.5).</summary>
    public static async Task UnlinkMembershipAsync(UnitOfWork unitOfWork, Guid organizationId, Guid membershipId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "UPDATE people.people SET membership_id = NULL, status = 'archived', updated_at = now(), version = version + 1 WHERE organization_id = $1 AND membership_id = $2",
            organizationId,
            membershipId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<Guid?> FindAsync(UnitOfWork unitOfWork, string sql, Guid organizationId, object value, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(sql, organizationId, value);
        return await command.ExecuteScalarAsync(cancellationToken) is Guid id ? id : null;
    }

    private static async Task<bool> HasPrimaryEmailAsync(UnitOfWork unitOfWork, Guid organizationId, Guid personId, CancellationToken cancellationToken)
    {
        await using var command = unitOfWork.Command(
            "SELECT EXISTS (SELECT 1 FROM people.contact_points WHERE organization_id = $1 AND person_id = $2 AND type = 'email' AND is_primary)",
            organizationId,
            personId);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken))!;
    }
}

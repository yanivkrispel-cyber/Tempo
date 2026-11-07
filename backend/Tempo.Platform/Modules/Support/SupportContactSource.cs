using System.Net.Mail;
using Amazon.Runtime;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;

namespace Tempo.Platform.Modules.Support;

/// <summary>How studio staff reach the Tempo team: an email address, or an https link such as a WhatsApp link.</summary>
public sealed record SupportContact(string Contact, string Kind)
{
    public const int MaxLength = 300;

    /// <summary>The value as a person wrote it, or null when it is neither an email address nor an https link.</summary>
    public static SupportContact? Parse(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrEmpty(text) || text.Length > MaxLength)
        {
            return null;
        }

        if (Uri.TryCreate(text, UriKind.Absolute, out var uri))
        {
            return uri.Scheme == Uri.UriSchemeHttps && !string.IsNullOrEmpty(uri.Host) && string.IsNullOrEmpty(uri.UserInfo)
                ? new SupportContact(uri.AbsoluteUri, "url")
                : null;
        }

        return MailAddress.TryCreate(text, out var address) && address.Address == text && string.IsNullOrEmpty(address.DisplayName)
            ? new SupportContact(text, "email")
            : null;
    }
}

/// <summary>
/// Where the support contact comes from (board #584, PL-4). Deployed: the SSM standard parameter named by
/// SUPPORT_CONTACT_PARAMETER (`/tempo/&lt;env&gt;/support/contact`, written by a person; the stack only names it).
/// Locally and in tests: SUPPORT_CONTACT as given. Nothing set, or a value that is neither an email address nor an https
/// link, means no contact, and the console hides it. SSM is asked at most every ten minutes, so a new value shows
/// within ten minutes without a deploy. When SSM fails (throttled, denied, unreachable), the last value stays and SSM is
/// asked again after a minute, so a failed read never turns into an error for the person asking.
/// </summary>
public sealed class SupportContactSource(
    Func<string, string?> setting,
    Func<string, CancellationToken, Task<string?>>? readParameter = null,
    TimeProvider? clock = null) : IDisposable
{
    private static readonly TimeSpan Refresh = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RetryAfterFailure = TimeSpan.FromMinutes(1);

    private readonly TimeProvider time = clock ?? TimeProvider.System;

    private readonly SemaphoreSlim gate = new(1, 1);
    private SupportContact? contact;
    private DateTimeOffset nextRead = DateTimeOffset.MinValue;

    public void Dispose() => gate.Dispose();

    public async Task<SupportContact?> GetAsync(CancellationToken cancellationToken)
    {
        if (time.GetUtcNow() < nextRead)
        {
            return contact;
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            if (time.GetUtcNow() >= nextRead)
            {
                try
                {
                    contact = SupportContact.Parse(await ReadAsync(cancellationToken));
                    nextRead = time.GetUtcNow().Add(Refresh);
                }
                catch (Exception error) when (error is AmazonServiceException or AmazonClientException)
                {
                    // The type only: the message can carry the parameter's ARN.
                    await Console.Error.WriteLineAsync($"Support contact: the SSM read failed ({error.GetType().Name}); keeping the last value.");
                    nextRead = time.GetUtcNow().Add(RetryAfterFailure);
                }
            }

            return contact;
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<string?> ReadAsync(CancellationToken cancellationToken)
    {
        if (setting("SUPPORT_CONTACT") is { Length: > 0 } value)
        {
            return value;
        }

        if (setting("SUPPORT_CONTACT_PARAMETER") is not { Length: > 0 } name)
        {
            return null;
        }

        return await (readParameter ?? ReadFromSsmAsync)(name, cancellationToken);
    }

    private static async Task<string?> ReadFromSsmAsync(string name, CancellationToken cancellationToken)
    {
        using var ssm = new AmazonSimpleSystemsManagementClient();
        try
        {
            return (await ssm.GetParameterAsync(new GetParameterRequest { Name = name }, cancellationToken)).Parameter.Value;
        }
        catch (ParameterNotFoundException)
        {
            return null;
        }
    }
}

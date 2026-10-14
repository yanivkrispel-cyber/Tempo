namespace Tempo.Platform.BuildingBlocks.Errors;

/// <summary>How the API reports a broken rule (docs/26 section 8.5).</summary>
public enum ViolationKind
{
    Validation,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    Gone,
    TooManyRequests
}

/// <summary>
/// A business rule the caller broke. The API turns it into Problem Details
/// with <see cref="Code"/> as the stable `code`. The message is a short title
/// that is safe to show, never internal detail.
/// </summary>
public sealed class DomainRuleViolationException : Exception
{
    private const string InvalidRequest = "request.invalid";

    public DomainRuleViolationException(ViolationKind kind, string code, string title)
        : base(title)
    {
        Kind = kind;
        Code = code;
    }

    /// <summary>A validation failure on one request field; the API lists it under `errors`.</summary>
    public DomainRuleViolationException(ViolationKind kind, string code, string title, string field)
        : this(kind, code, title)
    {
        Field = field;
    }

    public DomainRuleViolationException()
        : this(ViolationKind.Validation, InvalidRequest, "The request is not valid.")
    {
    }

    public DomainRuleViolationException(string message)
        : this(ViolationKind.Validation, InvalidRequest, message)
    {
    }

    public DomainRuleViolationException(string message, Exception innerException)
        : base(message, innerException)
    {
        Kind = ViolationKind.Validation;
        Code = InvalidRequest;
    }

    public ViolationKind Kind { get; }

    public string Code { get; }

    /// <summary>The request field at fault, in the contract's camelCase, or null.</summary>
    public string? Field { get; }

    /// <summary>For <see cref="ViolationKind.TooManyRequests"/>: when to try again (the Retry-After header).</summary>
    public TimeSpan? RetryAfter { get; init; }
}

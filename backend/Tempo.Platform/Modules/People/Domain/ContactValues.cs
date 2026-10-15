using System.Net.Mail;
using PhoneNumbers;
using Tempo.Platform.BuildingBlocks.Errors;

namespace Tempo.Platform.Modules.People.Domain;

/// <summary>
/// How contact values are stored (docs/27 section 4.2): emails lowercased,
/// phones in E.164. Israeli local input (`050-1234567`, `03-1234567`) is read
/// with Israel as the default region; a number with a country code keeps it.
/// </summary>
public static class ContactValues
{
    private static readonly PhoneNumberUtil Phones = PhoneNumberUtil.GetInstance();

    public static string Phone(string input)
    {
        try
        {
            var number = Phones.Parse(input.Trim(), "IL");
            if (Phones.IsValidNumber(number))
            {
                return Phones.Format(number, PhoneNumberFormat.E164);
            }
        }
        catch (NumberParseException)
        {
            // Falls through to the same answer as a number that parses but is not valid.
        }

        throw new DomainRuleViolationException(ViolationKind.Validation, "contact_point.invalid_phone", "That phone number is not valid.", "phone");
    }

    public static string Email(string input)
    {
        var value = input.Trim().ToLowerInvariant();
        if (value.Length is < 3 or > 254 || !MailAddress.TryCreate(value, out var parsed) || parsed.Address != value)
        {
            throw new DomainRuleViolationException(ViolationKind.Validation, "contact_point.invalid_email", "That email address is not valid.", "email");
        }

        return value;
    }

    public static string Normalize(string type, string value) => type switch
    {
        "phone" => Phone(value),
        "email" => Email(value),
        _ => throw new DomainRuleViolationException(ViolationKind.Validation, "contact_point.invalid_type", "A contact is an email or a phone.", "type")
    };
}

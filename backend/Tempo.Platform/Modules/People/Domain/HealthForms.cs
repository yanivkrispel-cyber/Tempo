namespace Tempo.Platform.Modules.People.Domain;

public sealed record HealthQuestion(string Id, string Text);

public sealed record HealthForm(int Version, string Locale, IReadOnlyList<HealthQuestion> Questions);

/// <summary>
/// The platform's health declaration form (docs/31 section 3, H-1). The form is code: changing a question's meaning
/// is a new version, fixing a typo is not. Version 1 is a **draft** until the lawyer check (P-2). Answers are stored by
/// question id, so an old signature stays readable after a new version.
/// </summary>
public static class HealthForms
{
    public static readonly HealthForm V1 = new(
        1,
        "he-IL",
        [
            new("q1", "האם רופא אמר לך שיש לך בעיה בלב, או שמותר לך לעשות רק פעילות גופנית שרופא המליץ עליה?"),
            new("q2", "האם הרגשת כאב בחזה, בפעילות גופנית או במנוחה, בחודש האחרון?"),
            new("q3", "האם איבדת שיווי משקל בגלל סחרחורת, או איבדת הכרה, בשנה האחרונה?"),
            new("q4", "האם יש לך בעיה בעצמות, במפרקים או בגב שפעילות גופנית עלולה להחמיר?"),
            new("q5", "האם רופא רושם לך כיום תרופות ללחץ דם או ללב?"),
            new("q6", "האם יש הריון כרגע, או לידה בשלושת החודשים האחרונים?"),
            new("q7", "האם ידועה לך סיבה אחרת שבגללה אסור לך לעשות פעילות גופנית?")
        ]);

    public static HealthForm Current => V1;

    public static HealthForm? Find(int version) => version == V1.Version ? V1 : null;
}

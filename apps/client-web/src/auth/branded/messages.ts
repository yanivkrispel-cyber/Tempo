import type { CognitoSignInErrorCode } from "@tempo/api-client/auth";

/** The password policy of the pool (infrastructure, docs/36 section 4.1), in words under the field. */
export const PASSWORD_POLICY = "לפחות 12 תווים, עם אות גדולה ואות קטנה באנגלית, ספרה וסימן.";

/**
 * The one Hebrew text for each sign-in error (docs/36 section 4.1). None of them says whether an email exists:
 * an unknown email and a wrong password read the same.
 */
export function signInErrorText(code: CognitoSignInErrorCode): string {
  switch (code) {
    case "not_authorized":
      return "האימייל או הסיסמה לא נכונים.";
    case "code_mismatch":
      return "הקוד לא נכון. בדקו ונסו שוב.";
    case "code_expired":
      return "הקוד פג. שלחנו קוד חדש.";
    case "invalid_password":
      return PASSWORD_POLICY;
    case "invalid_parameter":
      return "בדקו את הפרטים ונסו שוב.";
    case "too_many_attempts":
      return "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.";
    case "delivery_failed":
      return "לא הצלחנו לשלוח קוד. נסו שוב.";
    case "passkey_cancelled":
      return "הכניסה המהירה בוטלה. אפשר לנסות שוב או להיכנס עם סיסמה.";
    default:
      return "משהו השתבש. אפשר להיכנס גם בדרך הרגילה.";
  }
}

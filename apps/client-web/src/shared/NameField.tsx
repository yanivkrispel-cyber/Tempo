import { Field, Input } from "./design-system";

/** An account with no name joins as its email prefix, so the studio, the roster and the greeting show that (P3 F3). */
export function needsName(displayName: string | null | undefined): boolean {
  return !displayName?.trim();
}

export const nameMissing = "כתבו את השם שלכם, כך הסטודיו יידע מי הצטרף.";

/** "איך קוראים לך?" on a join or an invitation, for an account that has no name yet. */
export function NameField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <Field label="איך קוראים לך?" help="השם שהסטודיו יראה" error={error} required>
      <Input value={value} onChange={(event) => onChange(event.target.value)} autoComplete="name" maxLength={100} />
    </Field>
  );
}

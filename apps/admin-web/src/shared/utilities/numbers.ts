/** A whole number typed in a text field ("12", " 8 "), or null for anything else. */
export function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

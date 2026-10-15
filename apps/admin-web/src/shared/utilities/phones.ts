/**
 * How an E.164 phone is shown (the API stores E.164, docs/27 section 4.2). Israeli numbers in the local form
 * people read and dial: mobiles 05X-XXX-XXXX, landlines 0X-XXX-XXXX. Anything else stays E.164.
 */
export function displayPhone(e164: string): string {
  const local = /^\+972(\d{8,9})$/.exec(e164)?.[1];
  if (!local) return e164;
  const national = `0${local}`;
  return national.length === 10
    ? `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
    : `${national.slice(0, 2)}-${national.slice(2, 5)}-${national.slice(5)}`;
}

/** True when the text looks like a phone number rather than a name (digits, spaces, +, -, parentheses). */
export function looksLikePhone(text: string): boolean {
  return /^[+\d][\d\s()-]{5,}$/.test(text.trim());
}

/**
 * The search text for a typed phone: the API matches stored E.164 values, so a local number (050-123…) becomes
 * +97250123…; other text is sent as typed.
 */
export function phoneSearchText(text: string): string {
  const trimmed = text.trim();
  if (!looksLikePhone(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  return digits.startsWith("0") ? `+972${digits.slice(1)}` : digits;
}

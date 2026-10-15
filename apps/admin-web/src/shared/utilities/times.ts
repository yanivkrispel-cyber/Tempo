/** A local time of day, 24-hour "HH:MM", as the API sends it. */
export type Time = string;

const pad = (value: number) => String(value).padStart(2, "0");

/** Reads a typed time: "18:30", "18.30", "1830", "930", "18" or "9:05". Returns null for anything else. */
export function parseTime(text: string): Time | null {
  const match = /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  return hours <= 23 && minutes <= 59 ? `${pad(hours)}:${pad(minutes)}` : null;
}

export function minutesOf(time: Time): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Every `step` minutes from `from` to `to`, both included when they fall on a step. */
export function timeOptions(step: number, from: Time, to: Time): Time[] {
  const times: Time[] = [];
  for (let minutes = minutesOf(from); minutes <= minutesOf(to); minutes += Math.max(step, 1)) {
    times.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }
  return times;
}

/** The options that begin with what was typed, read as digits: "18" → 18:00…, "183" → 18:30…, "9" → 09:00…. */
export function matchTimes(options: readonly Time[], typed: string): Time[] {
  const digits = typed.replace(/\D/g, "");
  if (digits === "") return [...options];
  return options.filter((time) => {
    const optionDigits = time.replace(":", "");
    return optionDigits.startsWith(digits) || optionDigits.startsWith(`0${digits}`);
  });
}

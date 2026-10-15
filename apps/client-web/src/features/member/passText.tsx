// Sentences about a pass. The pass's name is the studio's own text (any language), so it sits in its own <bdi> and
// never takes a Hebrew prefix letter ("מ", "ב", "ל").
import type { ReactNode } from "react";
import { addDays, formatDate, type IsoDate } from "../../shared/utilities/dates";
import { entriesText } from "./bookingState";
import type { Pass, PassSummary } from "./studio";

const isCard = (pass: PassSummary) => pass.kind === "punch_card" && pass.entriesLeft != null;

/** "כרטיסיית 10 · נשארו 7 כניסות" or "מנוי חודשי · בתוקף עד 12.11.2026". */
export function passLine(pass: PassSummary): ReactNode {
  return (
    <>
      <bdi>{pass.name}</bdi> · {isCard(pass) ? entriesText(pass.entriesLeft!) : `בתוקף עד ${formatDate(pass.endsOn)}`}
    </>
  );
}

/** What booking will take from the pass the server would pick. */
export function passUseText(pass: PassSummary): ReactNode {
  if (isCard(pass)) {
    const after = pass.entriesLeft! - 1;
    return (
      <>
        תנוצל כניסה אחת מהכרטיסייה <bdi>{pass.name}</bdi>.{" "}
        {after === 0 ? "זו הכניסה האחרונה בכרטיסייה." : `אחרי ההרשמה ${entriesText(after)}.`}
      </>
    );
  }
  return (
    <>
      כלול במנוי <bdi>{pass.name}</bdi>, בתוקף עד {formatDate(pass.endsOn)}.
    </>
  );
}

/** What waiting will take: nothing now, one entry if a place frees up. */
export function waitPassText(pass: PassSummary): ReactNode {
  return isCard(pass) ? (
    <>
      בהמתנה לא נוצלת כניסה. אם יתפנה מקום, תנוצל כניסה אחת מהכרטיסייה <bdi>{pass.name}</bdi>.
    </>
  ) : (
    <>
      בהמתנה לא נוצל דבר. אם יתפנה מקום, ההרשמה תהיה במנוי <bdi>{pass.name}</bdi>.
    </>
  );
}

/** What a booking took, for the confirmation: "בכרטיסייה כרטיסיית 10 נשארו 6 כניסות." */
export function passTakenText(pass: PassSummary | null | undefined): ReactNode {
  if (!pass) return null;
  if (isCard(pass)) {
    return pass.entriesLeft === 0 ? (
      <>
        זו הייתה הכניסה האחרונה בכרטיסייה <bdi>{pass.name}</bdi>.
      </>
    ) : (
      <>
        בכרטיסייה <bdi>{pass.name}</bdi> {entriesText(pass.entriesLeft!)}.
      </>
    );
  }
  return (
    <>
      ההרשמה במנוי <bdi>{pass.name}</bdi>.
    </>
  );
}

/** Names and places joined with " · ", each isolated: a Latin name never reorders its Hebrew neighbours. */
export function metaLine(parts: ReadonlyArray<string | null | undefined>): ReactNode {
  const shown = parts.filter((part): part is string => Boolean(part));
  return shown.map((part, index) => (
    <span key={index}>
      {index > 0 && " · "}
      <bdi>{part}</bdi>
    </span>
  ));
}

/** A membership frozen today says when it resumes; otherwise the next freeze is mentioned. Nothing when there is none. */
export function freezeNote(freezes: Pass["freezes"], today: IsoDate): ReactNode {
  const ongoing = freezes?.find((freeze) => freeze.startsOn <= today && freeze.endsOn >= today);
  if (ongoing) {
    return <span role="status">המנוי מוקפא. הוא חוזר להיות בתוקף ב־{formatDate(addDays(ongoing.endsOn, 1))}.</span>;
  }
  const next = freezes?.find((freeze) => freeze.startsOn > today);
  if (!next) return null;
  return (
    <span className="tp-caption">
      הקפאה מתוכננת: {formatDate(next.startsOn)} עד {formatDate(next.endsOn)}. בימים האלה אי אפשר להירשם לשיעורים.
    </span>
  );
}

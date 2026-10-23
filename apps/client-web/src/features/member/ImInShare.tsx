import { useEffect, useMemo, useState } from "react";
import { useStudioBrand } from "../../app/studioLook";
import { ACCENTS, Button, DEFAULT_ACCENT } from "../../shared/design-system";
import type { IsoDate } from "../../shared/utilities/dates";
import { saveFile } from "../../shared/utilities/saveFile";
import { usePublicSession } from "../public/publicStudio";
import { imInFile } from "./drawImIn";
import { shortDayName } from "./format";
import type { Session, Studio } from "./studio";
import { clockTime } from "./studioTime";

/** The studio's accent as applied on `<html>` (useStudioAccent), as the card's colour. */
function appliedAccent(): string {
  const id = document.documentElement.getAttribute("data-accent") ?? DEFAULT_ACCENT;
  return (ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0]!).brand;
}

/**
 * "שיתוף לסטורי" (M-5, docs/37 8.1): the "אני בפנים" card with her own link. The picture is drawn ahead, once the
 * public class has answered, because a phone opens the share sheet only from the tap itself. Without a share sheet
 * that takes files (a computer) the picture is saved instead, said on the button for a moment.
 */
export function ImInShare({
  studio,
  session,
  spotLabel,
  timeZone,
  today,
  url,
  text,
}: {
  studio: Studio;
  session: Session;
  spotLabel: string | null;
  timeZone: string;
  today: IsoDate;
  /** Her own link (C-1), or the plain class address while it is on its way. */
  url: string;
  text: string;
}) {
  // The public class names the instructor only when their profile is public (M-14), and says when few spots are left.
  const publicSession = usePublicSession(studio.slug, session.id);
  // The studio's Instagram tag, which the brand carries only while its public page is on (M-15).
  const brand = useStudioBrand(studio.slug);
  const settled = !publicSession.isPending && !brand.isPending;
  const handle = brand.data?.instagramHandle ?? null;
  const instructor = publicSession.data?.instructor?.displayName ?? null;
  const spotsLeft = publicSession.data?.spotsLeft ?? null;
  const coverUrl = session.classType.coverUrl ?? null;
  const card = useMemo(
    () => ({
      className: session.classType.name,
      when: `${session.localDate === today ? "היום" : shortDayName(session.localDate)} ${clockTime(session.startsAt, timeZone)}`,
      spotLabel,
      instructor,
      studioName: studio.name,
      footnote: spotsLeft && spotsLeft > 0 ? `נשארו ${spotsLeft} מקומות` : null,
      handle,
      accent: appliedAccent(),
    }),
    [
      session.classType.name,
      session.localDate,
      session.startsAt,
      today,
      timeZone,
      spotLabel,
      instructor,
      studio.name,
      spotsLeft,
      handle,
    ],
  );
  // The picture drawn for this card; a stale one counts as still being drawn.
  const [made, setMade] = useState<{ card: typeof card; file: File | null } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settled) return;
    let live = true;
    void imInFile(card, coverUrl)
      .catch(() => null)
      .then((file) => {
        if (live) setMade({ card, file });
      });
    return () => {
      live = false;
    };
  }, [settled, card, coverUrl]);
  const file = made?.card === card ? made.file : null;
  const preparing = made?.card !== card;

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  // A browser that cannot draw (or a cover that tainted the canvas) leaves only the link button beside this one.
  if (!preparing && !file) return null;

  async function share() {
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text, url }).catch(() => undefined);
      return;
    }
    saveFile(file, "tempo-class.png");
    setSaved(true);
  }

  return (
    <Button variant="secondary" icon={saved ? "check" : "image"} loading={preparing} onClick={() => void share()}>
      <span aria-live="polite">{saved ? "התמונה נשמרה" : "שיתוף לסטורי"}</span>
    </Button>
  );
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@tempo/api-client";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useApi } from "../../api/ApiProvider";
import { errorMessage } from "../../api/errors";
import { CopyLink } from "../../shared/CopyLink";
import {
  ACCENTS,
  Banner,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Segmented,
  Select,
  Skeleton,
  Textarea,
  useToast,
  type AccentId,
} from "../../shared/design-system";
import { addDays, startOfWeek, todayIn } from "../../shared/utilities/dates";
import { clockTime } from "../../shared/utilities/times";
import { useStudio } from "../console/studio";
import { useInstructorProfiles } from "../console/experience";
import { useSessions, useStudioTimeZone } from "../schedule/queries";
import { drawStory, loadStoryFonts, STORY_HEIGHT, STORY_WIDTH } from "./drawStory";
import styles from "./publish.module.css";
import { candidates, maxSlots, templates, toSlot, whatsappText, type StorySlot, type TemplateId } from "./storyData";

type MarketingLink = Schemas["MarketingLink"];

const NOTE_LIMIT = 40;

const emptyText: Record<TemplateId, string> = {
  week: "אין שיעורים בשבוע הזה.",
  today: "אין היום שיעורים שעוד לא התחילו.",
  spot_opened: "אין בימים הקרובים שיעור עם מקום פנוי.",
  change: "אין ביטולים בשבוע הקרוב.",
};

/**
 * `/o/:slug/publish`, "פרסום" (docs/37 section 7, MO3): the four stage A stories drawn on the device at 1080x1920,
 * shared to Instagram from a phone or downloaded on a computer, each with its own link copied for the link sticker,
 * and the same story as WhatsApp text. Owners and admins pick any class; an instructor only their own (M-4).
 */
export function PublishPage() {
  const studio = useStudio();
  const canAll = studio.can("marketing.publish");
  const canOwn = studio.can("marketing.publish.own");

  if (!canAll && !canOwn) {
    return (
      <EmptyState title="אין לך גישה לפרסום" titleAs="h1" icon="shield">
        סטוריז לסטודיו מכינים הבעלים, המנהלים, והמדריכים לשיעורים שלהם.
      </EmptyState>
    );
  }
  return <Publisher ownOnly={!canAll} />;
}

function Publisher({ ownOnly }: { ownOnly: boolean }) {
  const api = useApi();
  const studio = useStudio();
  const { organizationId } = studio;
  const { timeZone, error: zoneError } = useStudioTimeZone();
  const toast = useToast();

  const [now] = useState(() => new Date());
  const today = timeZone ? todayIn(timeZone, now) : null;
  const thisWeek = today ? startOfWeek(today) : null;
  // This week and the next: the week template's two choices, and the next 7 days for the others.
  const sessions = useSessions(thisWeek ?? "", thisWeek ? addDays(thisWeek, 13) : "");
  const instructors = useInstructorProfiles();
  const brand = useQuery({
    queryKey: ["studio", organizationId, "brand"],
    queryFn: () =>
      unwrap(api.GET("/api/v1/organizations/{organizationId}/brand", { params: { path: { organizationId } } })),
  });
  const accentId: AccentId = brand.data?.accentId ?? "sage";
  const accent = (ACCENTS.find((item) => item.id === accentId) ?? ACCENTS[0]!).ground;

  const [template, setTemplate] = useState<TemplateId>("week");
  const [week, setWeek] = useState<"this" | "next">("this");
  const [chosen, setChosen] = useState<Partial<Record<string, string[]>>>({});
  const [showInstructors, setShowInstructors] = useState(true);
  const [showLeft, setShowLeft] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ image: CanvasImageSource; name: string } | null>(null);

  const publicInstructors = useMemo(() => {
    if (!showInstructors || !instructors.data) return null;
    return new Set(
      [...instructors.data.values()].filter((item) => item.publicProfile).map((item) => item.membershipId),
    );
  }, [instructors.data, showInstructors]);

  const weekStart = thisWeek ? (week === "this" ? thisWeek : addDays(thisWeek, 7)) : null;
  const all = useMemo(() => {
    if (!timeZone || !sessions.data) return [];
    const own = ownOnly
      ? sessions.data.filter((session) => session.instructor?.membershipId === studio.membership.membershipId)
      : sessions.data;
    return [...own]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((session) => toSlot(session, timeZone, { showLeft, publicInstructors }));
  }, [sessions.data, timeZone, ownOnly, studio.membership.membershipId, showLeft, publicInstructors]);

  const choiceKey = template === "week" ? `week:${week}` : template;
  const { offered, shown } = useMemo(() => {
    if (!today || !timeZone || !weekStart) return { offered: [] as StorySlot[], shown: [] as string[] };
    const range =
      template === "week"
        ? all.filter((slot) => slot.date >= weekStart && slot.date <= addDays(weekStart, 6))
        : all.filter((slot) => slot.date <= addDays(today, 7));
    return candidates(template, range, { today, time: clockTime(now, timeZone) });
  }, [all, template, today, timeZone, weekStart, now]);
  const picked = chosen[choiceKey] ?? shown;
  const slots = offered.filter((slot) => picked.includes(slot.id)).slice(0, maxSlots[template]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadStoryFonts().finally(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !today || !weekStart) return;
    drawStory(context, {
      template,
      studioName: studio.displayName,
      accent,
      slots,
      today,
      weekStart,
      note: template === "week" ? note.trim() : "",
      photo: template === "week" || template === "today" ? (photo?.image ?? null) : null,
    });
    // `slots` is derived on every render; its ids and labels are what change the picture.
  }, [template, studio.displayName, accent, JSON.stringify(slots), today, weekStart, note, photo, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // An instructor's link must name one of their sessions (M-4); the owner's leads to the studio's page.
  const sessionId = template === "spot_opened" || ownOnly ? (slots[0]?.id ?? null) : null;
  const linkKey = `${template}:${sessionId ?? ""}`;
  const createLink = (channel: "story" | "whatsapp") =>
    unwrap(
      api.POST("/api/v1/organizations/{organizationId}/marketing/links", {
        params: { path: { organizationId } },
        body: { channel, template, sessionId },
      }),
    );

  const [prepared, setPrepared] = useState<{ key: string; link: MarketingLink } | null>(null);
  const ready = prepared?.key === linkKey ? prepared.link : null;
  const [shareFiles] = useState(canShareFiles);
  const fileName = `${studio.slug}-${template}.png`;

  const prepare = useMutation({
    mutationFn: () => createLink("story"),
    onSuccess: async (link) => {
      setPrepared({ key: linkKey, link });
      // A computer downloads right away; a phone's share sheet needs a fresh tap, so it waits for "שיתוף".
      if (!shareFiles) {
        const copied = await copyText(link.url);
        await download(canvas.current, fileName);
        toast.show({
          tone: "success",
          icon: "check",
          message: copied ? "הלינק הועתק, הדביקי אותו במדבקת הלינק" : "התמונה ירדה. הלינק מחכה כאן להעתקה.",
        });
      }
    },
  });

  const share = async (link: MarketingLink) => {
    // Both in the same tap: the clipboard first, then the share sheet.
    const copied = copyText(link.url);
    const file = await pngFile(canvas.current, fileName);
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") await download(canvas.current, fileName);
    }
    if (await copied) toast.show({ tone: "success", icon: "check", message: "הלינק הועתק, הדביקי אותו במדבקת הלינק" });
  };

  const [whatsapp, setWhatsapp] = useState<{ key: string; text: string } | null>(null);
  const whatsappMessage =
    whatsapp?.key === `${linkKey}:${JSON.stringify(slots.map((slot) => slot.id))}` ? whatsapp : null;
  const writeWhatsapp = useMutation({
    mutationFn: () => createLink("whatsapp"),
    onSuccess: async (link) => {
      const text = whatsappText(template, studio.displayName, slots, link.url, today!);
      setWhatsapp({ key: `${linkKey}:${JSON.stringify(slots.map((slot) => slot.id))}`, text });
      if (await copyText(text))
        toast.show({ tone: "success", icon: "check", message: "הטקסט הועתק, אפשר להדביק בוואטסאפ" });
    },
  });

  const choose = (id: string, on: boolean) => {
    const next = on ? [...picked, id] : picked.filter((item) => item !== id);
    setChosen({ ...chosen, [choiceKey]: next });
  };

  const pickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setPhoto({ image: await readImage(file), name: file.name });
    } catch {
      toast.show({ tone: "danger", icon: "info", message: "לא הצלחנו לפתוח את התמונה. נסי תמונה אחרת." });
    }
  };

  const loading = !timeZone || sessions.isPending;
  const failed = zoneError ?? sessions.error;
  const full =
    template !== "spot_opened" &&
    picked.filter((id) => offered.some((slot) => slot.id === id)).length >= maxSlots[template];

  return (
    <>
      <header>
        <span className="tp-eyebrow">שיווק</span>
        <h1>פרסום</h1>
        <p className="tp-muted">
          סטורי מוכן מהמערכת, בצבע של הסטודיו. כל סטורי מקבל לינק משלו, כדי שנדע מאיפה הגיעו ההרשמות.
        </p>
      </header>

      <div className={styles.layout}>
        <figure className={styles.preview} aria-label="תצוגה מקדימה של הסטורי">
          <canvas
            ref={canvas}
            width={STORY_WIDTH}
            height={STORY_HEIGHT}
            className={styles.story}
            role="img"
            aria-label={storyDescription(template, slots)}
          />
          <figcaption className="tp-caption tp-muted">האזור הריק למטה שמור למדבקת הלינק של אינסטגרם.</figcaption>
        </figure>

        <div className={`tp-stack ${styles.controls}`}>
          <div role="group" aria-label="תבנית" className={styles.templates}>
            {templates.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.template}
                aria-pressed={template === item.id}
                onClick={() => setTemplate(item.id)}
              >
                <strong>{item.name}</strong>
                <span>{item.caption}</span>
              </button>
            ))}
          </div>

          {failed ? (
            <Banner tone="danger" icon="info">
              {errorMessage(failed, "לא הצלחנו לטעון את המערכת. נסו שוב.")}
            </Banner>
          ) : loading ? (
            <Skeleton height={180} />
          ) : (
            <>
              {template === "week" && (
                <Segmented
                  label="שבוע"
                  value={week}
                  onChange={setWeek}
                  options={[
                    { value: "this", label: "השבוע" },
                    { value: "next", label: "שבוע הבא" },
                  ]}
                />
              )}

              {offered.length === 0 ? (
                <p className="tp-muted">{emptyText[template]}</p>
              ) : template === "spot_opened" ? (
                <Field label="השיעור">
                  <Select
                    value={slots[0]?.id ?? ""}
                    onChange={(event) => setChosen({ ...chosen, [choiceKey]: [event.target.value] })}
                  >
                    {offered.map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {`${slotTitle(slot)} · ${slot.free === 1 ? "מקום אחד" : `${slot.free} מקומות`}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <fieldset className={styles.slots}>
                  <legend className="tp-field__label">{`השיעורים בסטורי (עד ${maxSlots[template]})`}</legend>
                  {offered.map((slot) => {
                    const on = picked.includes(slot.id);
                    return (
                      <div key={slot.id} className={styles.slot}>
                        <Checkbox
                          label={slotTitle(slot)}
                          checked={on}
                          disabled={!on && full}
                          onChange={(event) => choose(slot.id, event.target.checked)}
                        />
                        {slot.label && (
                          <span className={styles.label} data-tone={slot.label.tone}>
                            {slot.label.text}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </fieldset>
              )}

              <div className="tp-stack" style={{ gap: 8 }}>
                <Checkbox
                  label="להציג מדריכים"
                  checked={showInstructors}
                  onChange={(event) => setShowInstructors(event.target.checked)}
                />
                <p className="tp-field__help">רק מדריכים שהסכימו להופיע בעמוד הציבורי.</p>
                {template === "week" && (
                  <Checkbox
                    label="להציג כמה מקומות נשארו"
                    checked={showLeft}
                    onChange={(event) => setShowLeft(event.target.checked)}
                  />
                )}
              </div>

              {template === "week" && (
                <Field label="הערה בכתב יד" help={`${note.length} מתוך ${NOTE_LIMIT} תווים.`}>
                  <Input
                    value={note}
                    maxLength={NOTE_LIMIT}
                    placeholder="חמישי בערב: שיעור מיוחד"
                    onChange={(event) => setNote(event.target.value)}
                  />
                </Field>
              )}

              {(template === "week" || template === "today") && (
                <div className="tp-field">
                  <span className="tp-field__label">תמונת רקע</span>
                  <div className="tp-row">
                    <label className={`tp-btn tp-btn--secondary ${styles.pick}`}>
                      <input
                        type="file"
                        accept="image/*"
                        className="tp-sr-only"
                        onChange={(event) => void pickPhoto(event)}
                      />
                      {photo ? "החלפת התמונה" : "בחירת תמונה"}
                    </label>
                    {photo && (
                      <Button variant="ghost" onClick={() => setPhoto(null)}>
                        הסרה
                      </Button>
                    )}
                  </div>
                  <p className="tp-field__help">
                    {photo ? photo.name : "תמונה מהטלפון או מהמחשב. בלי תמונה, הרקע בצבע של הסטודיו."}
                  </p>
                </div>
              )}

              {(prepare.isError || writeWhatsapp.isError) && (
                <Banner tone="danger" icon="info">
                  {errorMessage(prepare.error ?? writeWhatsapp.error, "לא הצלחנו ליצור לינק. נסו שוב.")}
                </Banner>
              )}

              <div className={styles.actions}>
                {ready && shareFiles ? (
                  <Button icon="share" onClick={() => void share(ready)}>
                    שיתוף לסטורי
                  </Button>
                ) : (
                  <Button
                    icon={shareFiles ? "share" : "arrow-down"}
                    loading={prepare.isPending}
                    disabled={slots.length === 0}
                    onClick={() => prepare.mutate()}
                  >
                    {shareFiles ? "הכנה לשיתוף" : "הורדה והעתקת הלינק"}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  loading={writeWhatsapp.isPending}
                  disabled={slots.length === 0}
                  onClick={() => writeWhatsapp.mutate()}
                >
                  טקסט לוואטסאפ
                </Button>
              </div>

              {ready && <CopyLink link={ready.url} label="הלינק של הסטורי, למדבקת הלינק" />}

              {whatsappMessage && (
                <div className="tp-stack" style={{ gap: 8 }}>
                  <Field label="הטקסט לוואטסאפ">
                    <Textarea
                      readOnly
                      rows={Math.min(10, whatsappMessage.text.split("\n").length + 1)}
                      value={whatsappMessage.text}
                    />
                  </Field>
                  <div className="tp-row">
                    <Button variant="secondary" icon="check" onClick={() => void copyText(whatsappMessage.text)}>
                      העתקה
                    </Button>
                    <a
                      className="tp-btn tp-btn--ghost"
                      href={`https://wa.me/?text=${encodeURIComponent(whatsappMessage.text)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      פתיחה בוואטסאפ
                    </a>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function slotTitle(slot: StorySlot): string {
  return `יום ${slot.weekday} ${slot.time} · ${slot.name}`;
}

/** What the picture says, for a screen reader. */
function storyDescription(template: TemplateId, slots: readonly StorySlot[]): string {
  const name = templates.find((item) => item.id === template)!.name;
  return slots.length === 0 ? `סטורי: ${name}` : `סטורי: ${name}. ${slots.map(slotTitle).join(", ")}`;
}

function canShareFiles(): boolean {
  try {
    return (
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [new File([new Uint8Array([0])], "story.png", { type: "image/png" })] })
    );
  } catch {
    return false;
  }
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

async function pngFile(canvas: HTMLCanvasElement | null, name: string): Promise<File | null> {
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], name, { type: "image/png" }) : null;
}

async function download(canvas: HTMLCanvasElement | null, name: string) {
  const file = await pngFile(canvas, name);
  if (!file) return;
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A picture from the device: an object URL never taints the canvas, so the story still exports. */
async function readImage(file: File): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

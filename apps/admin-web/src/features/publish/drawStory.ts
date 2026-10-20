import type { IsoDate } from "../../shared/utilities/dates";
import {
  offerHeadline,
  untilWords,
  whenWord,
  weekRange,
  type LabelTone,
  type OfferInfo,
  type StorySlot,
  type TemplateId,
} from "./storyData";

/**
 * The stage A stories drawn with Canvas 2D at 1080x1920 (docs/37 section 7.3): no server, no library that copies the
 * DOM. Each template is one fixed design in the studio's accent, right to left, in Warm Glass type, with the bottom
 * left free for Instagram's link sticker.
 */
export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
/** Kept empty at the bottom: Instagram's link sticker goes here. */
const STICKER_ROOM = 320;
const SIDE = 72;

const DISPLAY = '"Frank Ruhl Libre", "David Libre", Georgia, serif';
const UI = '"IBM Plex Sans Hebrew", "Heebo", "Segoe UI", system-ui, sans-serif';
/** The condensed face for times (docs/37 section 7.2). */
const CONDENSED = '"Karantina", "IBM Plex Sans Hebrew", sans-serif';
const INK = "#2b2420";

export interface StoryInput {
  template: TemplateId;
  studioName: string;
  /** The studio's accent ground (docs/35 W-1). */
  accent: string;
  slots: readonly StorySlot[];
  /** The offer story's product. */
  offer?: OfferInfo | null;
  /** The studio's today, for "היום" and "מחר". */
  today: IsoDate;
  /** The week template's first day. */
  weekStart: IsoDate;
  /** The week's handwritten note, at most 40 characters. */
  note: string;
  /** A picture the owner picked from the device; drawn as a cover behind the week and today templates. */
  photo: CanvasImageSource | null;
}

const KARANTINA = "https://fonts.googleapis.com/css2?family=Karantina:wght@700&display=swap";

/**
 * Loads the story's faces before drawing, or the canvas falls back to a system font for good. The console already
 * declares Frank Ruhl Libre and IBM Plex Sans Hebrew; the condensed face is added only on this screen.
 */
export async function loadStoryFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  if (!document.querySelector(`link[href="${KARANTINA}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = KARANTINA;
    const loaded = new Promise<void>((resolve) => {
      link.onload = () => resolve();
      link.onerror = () => resolve();
    });
    document.head.append(link);
    await loaded;
  }
  const sample = "אבג 0123:";
  await Promise.all(
    [`500 100px ${DISPLAY}`, `400 40px ${UI}`, `600 40px ${UI}`, `700 40px ${UI}`, `700 100px ${CONDENSED}`].map(
      (font) => document.fonts.load(font, sample).catch(() => []),
    ),
  );
}

export function drawStory(ctx: CanvasRenderingContext2D, input: StoryInput): void {
  ctx.save();
  ctx.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  ctx.direction = "rtl";
  ctx.textBaseline = "alphabetic";
  switch (input.template) {
    case "week":
      drawWeek(ctx, input);
      break;
    case "today":
      drawToday(ctx, input);
      break;
    case "spot_opened":
      drawSpotOpened(ctx, input);
      break;
    case "change":
      drawChange(ctx, input);
      break;
    case "offer":
      drawOffer(ctx, input);
      break;
  }
  ctx.restore();
}

// --- the week in the studio -------------------------------------------------------------------------------------

function drawWeek(ctx: CanvasRenderingContext2D, input: StoryInput) {
  ground(ctx, input);
  const right = STORY_WIDTH - SIDE;

  text(ctx, input.studioName, STORY_WIDTH / 2, 150, {
    font: `600 36px ${UI}`,
    align: "center",
    spacing: 10,
    alpha: 0.9,
  });
  text(ctx, "השבוע בסטודיו", STORY_WIDTH / 2, 290, {
    font: `500 118px ${DISPLAY}`,
    align: "center",
    color: mix(input.accent, "#ffffff", 0.78),
    max: STORY_WIDTH - 2 * SIDE,
  });
  text(ctx, weekRange(input.weekStart), STORY_WIDTH / 2, 372, { font: `600 46px ${UI}`, align: "center" });

  const slots = input.slots;
  if (slots.length === 0) return;
  const top = 450;
  const bottom = STORY_HEIGHT - STICKER_ROOM - (input.note ? 150 : 40);
  const row = Math.min(150, (bottom - top) / slots.length);
  const scale = row / 150;

  slots.forEach((slot, index) => {
    const y = top + index * row;
    const middle = y + row / 2;
    if (index > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(SIDE, y, STORY_WIDTH - 2 * SIDE, 2);
    }
    // The day and time on the right, the class in the middle, its label on the left.
    text(ctx, slot.weekday, right, middle - 22 * scale, { font: `600 ${Math.round(32 * scale)}px ${UI}`, alpha: 0.82 });
    const timeWidth = text(ctx, slot.time, right, middle + 46 * scale, {
      font: `700 ${Math.round(86 * scale)}px ${CONDENSED}`,
      alpha: slot.cancelled ? 0.7 : 1,
    });
    const nameRight = right - Math.max(timeWidth, 150 * scale) - 36;
    const chip = slot.label ? chipWidth(ctx, slot.label.text, scale) : 0;
    const nameMax = nameRight - SIDE - chip - (chip ? 24 : 0);
    const nameY = slot.instructor ? middle - 2 * scale : middle + 16 * scale;
    const nameWidth = text(ctx, slot.name, nameRight, nameY, {
      font: `700 ${Math.round(46 * scale)}px ${UI}`,
      max: nameMax,
      alpha: slot.cancelled ? 0.7 : 1,
    });
    if (slot.cancelled) strike(ctx, nameRight - nameWidth, nameRight, nameY - 16 * scale, 6 * scale);
    if (slot.instructor) {
      text(ctx, slot.instructor, nameRight, middle + 42 * scale, {
        font: `400 ${Math.round(32 * scale)}px ${UI}`,
        max: nameMax,
        alpha: 0.8,
      });
    }
    if (slot.label) drawChip(ctx, slot.label, SIDE, middle, scale);
  });

  if (input.note) {
    ctx.save();
    ctx.translate(right - 20, STORY_HEIGHT - STICKER_ROOM - 70);
    ctx.rotate((-6 * Math.PI) / 180);
    text(ctx, input.note, 0, 0, { font: `500 58px ${DISPLAY}`, max: STORY_WIDTH * 0.7, shadow: true });
    ctx.restore();
  }
}

// --- last places today ------------------------------------------------------------------------------------------

function drawToday(ctx: CanvasRenderingContext2D, input: StoryInput) {
  ground(ctx, input);
  const right = STORY_WIDTH - SIDE;
  const first = input.slots[0];
  text(ctx, first ? `היום · יום ${first.weekday}` : "היום", right, 170, {
    font: `600 38px ${UI}`,
    spacing: 4,
    alpha: 0.88,
  });
  const lines = wrap(ctx, "מקומות אחרונים היום", `500 136px ${DISPLAY}`, STORY_WIDTH - 2 * SIDE);
  lines.forEach((line, index) => text(ctx, line, right, 320 + index * 136, { font: `500 136px ${DISPLAY}` }));

  const cards = input.slots;
  const height = 196;
  const gap = 26;
  let y = STORY_HEIGHT - STICKER_ROOM - cards.length * (height + gap) + gap;
  for (const slot of cards) {
    ctx.save();
    ctx.globalAlpha = slot.free === 0 ? 0.62 : 1;
    ctx.fillStyle = "rgba(255,253,250,0.93)";
    roundRect(ctx, SIDE - 16, y, STORY_WIDTH - 2 * SIDE + 32, height, 44);
    ctx.fill();
    const inner = right - 30;
    const timeWidth = text(ctx, slot.time, inner, y + 128, { font: `700 104px ${CONDENSED}`, color: INK });
    const left = inner - Math.max(timeWidth, 170) - 34;
    text(ctx, slot.instructor ? `${slot.name} · ${slot.instructor}` : slot.name, left, y + 82, {
      font: `700 44px ${UI}`,
      color: INK,
      max: left - SIDE - 14,
    });
    drawPlaces(ctx, slot, left, y + 138, input.accent);
    ctx.restore();
    y += height + gap;
  }
}

/** Dots for the places when they fit (a filled dot is a booked place), else the number left. */
function drawPlaces(ctx: CanvasRenderingContext2D, slot: StorySlot, right: number, middle: number, accent: string) {
  const dot = 30;
  const step = 42;
  const note = slot.free === 0 ? "מלא" : slot.free === 1 ? "מקום אחד" : `${slot.free} פנויים`;
  if (slot.capacity > 0 && slot.capacity <= 14) {
    for (let index = 0; index < slot.capacity; index++) {
      const x = right - dot / 2 - index * step;
      ctx.beginPath();
      ctx.arc(x, middle, dot / 2, 0, Math.PI * 2);
      if (index < slot.booked) {
        ctx.fillStyle = accent;
        ctx.fill();
      } else {
        ctx.lineWidth = 5;
        ctx.strokeStyle = accent;
        ctx.stroke();
      }
    }
    text(ctx, note, right - slot.capacity * step - 12, middle + 12, { font: `600 34px ${UI}`, color: "#8a5f53" });
    return;
  }
  text(
    ctx,
    slot.free === 0 ? "מלא" : slot.free === 1 ? "נשאר מקום אחד" : `נשארו ${slot.free} מקומות`,
    right,
    middle + 12,
    {
      font: `600 36px ${UI}`,
      color: "#8a5f53",
    },
  );
}

// --- a place freed up -------------------------------------------------------------------------------------------

function drawSpotOpened(ctx: CanvasRenderingContext2D, input: StoryInput) {
  const deep = mix(input.accent, "#000000", 0.18);
  const light = mix(input.accent, "#ffffff", 0.82);
  ctx.fillStyle = deep;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  glow(ctx, mix(input.accent, "#ffffff", 0.25));
  const right = STORY_WIDTH - SIDE;
  const slot = input.slots[0];
  text(ctx, "התפנה עכשיו", right, 180, { font: `700 42px ${UI}`, spacing: 6, color: light });
  if (!slot) return;

  text(ctx, String(slot.free), right + 20, 980, { font: `700 860px ${CONDENSED}`, color: light, alpha: 0.95 });
  text(ctx, slot.free === 1 ? "מקום אחד" : `${slot.free} מקומות`, right, 1110, { font: `500 120px ${DISPLAY}` });
  text(ctx, `${whenWord(slot, input.today)} ב-${slot.time}`, right, 1240, {
    font: `500 96px ${DISPLAY}`,
    color: light,
  });

  // The class, with the instructor's initials (photos wait for the picture bucket's CORS, docs/37 section 7.3).
  const y = 1380;
  let textRight = right;
  if (slot.instructor) {
    const size = 128;
    ctx.beginPath();
    ctx.arc(right - size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = light;
    ctx.fill();
    text(ctx, initialsOf(slot.instructor), right - size / 2, y + size / 2 + 18, {
      font: `600 50px ${UI}`,
      align: "center",
      color: deep,
    });
    textRight = right - size - 32;
  }
  text(ctx, slot.name, textRight, y + 54, { font: `700 50px ${UI}`, max: textRight - SIDE });
  text(ctx, slot.instructor ? `עם ${slot.instructor}` : `יום ${slot.weekday}`, textRight, y + 112, {
    font: `400 40px ${UI}`,
    alpha: 0.85,
    max: textRight - SIDE,
  });
  text(ctx, "רשימת ההמתנה נסגרה, מי שנרשמת ראשונה מקבלת את המקום.", right, 1590, {
    font: `500 34px ${UI}`,
    alpha: 0.8,
    max: STORY_WIDTH - 2 * SIDE,
  });
}

// --- the timetable changed --------------------------------------------------------------------------------------

function drawChange(ctx: CanvasRenderingContext2D, input: StoryInput) {
  ctx.fillStyle = "#fbfaf8";
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  ctx.fillStyle = input.accent;
  ctx.fillRect(0, 0, STORY_WIDTH, 14);
  const right = STORY_WIDTH - SIDE;
  text(ctx, "עדכון במערכת", right, 160, { font: `600 38px ${UI}`, color: input.accent });
  text(ctx, input.studioName, SIDE, 160, { font: `600 38px ${UI}`, color: "#8a7f76", align: "left", max: 460 });
  const lines = wrap(ctx, "המערכת השתנתה", `500 150px ${DISPLAY}`, STORY_WIDTH - 2 * SIDE);
  lines.forEach((line, index) =>
    text(ctx, line, right, 340 + index * 150, { font: `500 150px ${DISPLAY}`, color: INK }),
  );

  let y = 340 + lines.length * 150 + 40;
  const height = 250;
  for (const slot of input.slots) {
    ctx.save();
    ctx.shadowColor = "rgba(43,36,32,0.10)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, SIDE, y, STORY_WIDTH - 2 * SIDE, height, 44);
    ctx.fill();
    ctx.restore();
    const inner = right - 48;
    drawChip(ctx, { tone: "cancel", text: "בוטל" }, inner, y + 62, 1, "right", true);
    const line = `יום ${slot.weekday} ${slot.time} · ${slot.name}`;
    const width = text(ctx, line, inner, y + 160, { font: `700 60px ${UI}`, color: INK, max: inner - SIDE - 48 });
    strike(ctx, inner - width, inner, y + 140, 6, "#9b3b30");
    if (slot.instructor) {
      text(ctx, `עם ${slot.instructor}`, inner, y + 218, {
        font: `400 38px ${UI}`,
        color: "#5e544c",
        max: inner - SIDE - 48,
      });
    }
    y += height + 36;
  }
  text(ctx, "שאר השיעורים כרגיל. נתראה בסטודיו!", right, STORY_HEIGHT - STICKER_ROOM - 30, {
    font: `500 40px ${UI}`,
    color: "#5e544c",
  });
}

// --- the offer for newcomers ------------------------------------------------------------------------------------

function drawOffer(ctx: CanvasRenderingContext2D, input: StoryInput) {
  ground(ctx, input);
  const right = STORY_WIDTH - SIDE;
  const light = mix(input.accent, "#ffffff", 0.82);
  text(ctx, input.studioName, STORY_WIDTH / 2, 150, {
    font: `600 36px ${UI}`,
    align: "center",
    spacing: 10,
    alpha: 0.9,
  });
  const offer = input.offer;
  if (!offer) return;
  text(ctx, "פעם ראשונה בסטודיו?", right, 560, { font: `700 42px ${UI}`, spacing: 6, color: light });
  const font = `500 150px ${DISPLAY}`;
  const lines = wrap(ctx, offerHeadline(offer), font, STORY_WIDTH - 2 * SIDE).slice(0, 4);
  lines.forEach((line, index) => text(ctx, line, right, 740 + index * 170, { font, max: STORY_WIDTH - 2 * SIDE }));
  let y = 740 + lines.length * 170 + 40;
  if (offer.blurb) {
    const blurbLines = wrap(ctx, offer.blurb, `400 46px ${UI}`, STORY_WIDTH - 2 * SIDE).slice(0, 3);
    blurbLines.forEach((line, index) =>
      text(ctx, line, right, y + index * 68, { font: `400 46px ${UI}`, alpha: 0.9, max: STORY_WIDTH - 2 * SIDE }),
    );
    y += blurbLines.length * 68 + 30;
  }
  if (offer.until) {
    const label = untilWords(offer.until);
    const width = chipWidth(ctx, label, 1.5);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    roundRect(ctx, right - width, y, width, 96, 48);
    ctx.fill();
    text(ctx, label, right - width / 2, y + 64, { font: `600 48px ${UI}`, align: "center" });
  }
  text(ctx, "נרשמים בלינק, משלמים בסטודיו.", right, STORY_HEIGHT - STICKER_ROOM - 30, {
    font: `500 38px ${UI}`,
    alpha: 0.85,
  });
}

// --- shared drawing ---------------------------------------------------------------------------------------------

/** The photo as a cover with the accent over it, or the accent alone. */
function ground(ctx: CanvasRenderingContext2D, input: StoryInput) {
  const deep = mix(input.accent, "#000000", 0.35);
  if (input.photo) {
    cover(ctx, input.photo);
    const tint = ctx.createLinearGradient(0, 0, 0, STORY_HEIGHT);
    tint.addColorStop(0, alpha(input.accent, 0.95));
    tint.addColorStop(0.4, alpha(input.accent, 0.78));
    tint.addColorStop(0.75, alpha(input.accent, 0.45));
    tint.addColorStop(1, "rgba(0,0,0,0.4)");
    ctx.fillStyle = tint;
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, STORY_HEIGHT);
    gradient.addColorStop(0, input.accent);
    gradient.addColorStop(1, deep);
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  if (!input.photo) glow(ctx, mix(input.accent, "#ffffff", 0.3));
}

function glow(ctx: CanvasRenderingContext2D, color: string) {
  const light = ctx.createRadialGradient(STORY_WIDTH * 0.85, 260, 40, STORY_WIDTH * 0.85, 260, 900);
  light.addColorStop(0, alpha(color, 0.45));
  light.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
}

function cover(ctx: CanvasRenderingContext2D, image: CanvasImageSource) {
  const { width, height } = sizeOf(image);
  if (!width || !height) return;
  const scale = Math.max(STORY_WIDTH / width, STORY_HEIGHT / height);
  const w = width * scale;
  const h = height * scale;
  ctx.drawImage(image, (STORY_WIDTH - w) / 2, (STORY_HEIGHT - h) / 2, w, h);
}

function sizeOf(image: CanvasImageSource): { width: number; height: number } {
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  const sized = image as { width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  return {
    width: typeof sized.width === "number" ? sized.width : 0,
    height: typeof sized.height === "number" ? sized.height : 0,
  };
}

interface TextOptions {
  font: string;
  align?: CanvasTextAlign;
  color?: string;
  alpha?: number;
  /** Narrower than this, the line ends with an ellipsis. */
  max?: number;
  /** Letter spacing in pixels, where the browser supports it. */
  spacing?: number;
  shadow?: boolean;
}

/** Draws one line (x is its right edge unless aligned otherwise) and returns its width. */
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, options: TextOptions): number {
  ctx.save();
  ctx.font = options.font;
  ctx.textAlign = options.align ?? "right";
  ctx.fillStyle = options.color ?? "#ffffff";
  ctx.globalAlpha *= options.alpha ?? 1;
  if (options.spacing && "letterSpacing" in ctx) ctx.letterSpacing = `${options.spacing}px`;
  if (options.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
  }
  const line = options.max ? fit(ctx, value, options.max) : value;
  ctx.fillText(line, x, y);
  const width = ctx.measureText(line).width;
  ctx.restore();
  return width;
}

/** The longest start of the text that fits, with an ellipsis. */
export function fit(ctx: Pick<CanvasRenderingContext2D, "measureText">, value: string, max: number): string {
  if (ctx.measureText(value).width <= max) return value;
  let end = value.length;
  while (end > 1 && ctx.measureText(`${value.slice(0, end).trimEnd()}…`).width > max) end--;
  return `${value.slice(0, end).trimEnd()}…`;
}

/** Splits a headline into lines by words. */
function wrap(ctx: CanvasRenderingContext2D, value: string, font: string, max: number): string[] {
  ctx.save();
  ctx.font = font;
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > max) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  ctx.restore();
  return lines;
}

const chipColors: Record<LabelTone, [string, string]> = {
  open: ["rgba(255,255,255,0.2)", "#ffffff"],
  last: ["rgba(255,255,255,0.2)", "#ffffff"],
  full: ["#ffffff", INK],
  cancel: ["#b4483b", "#ffffff"],
};

function chipWidth(ctx: CanvasRenderingContext2D, value: string, scale: number): number {
  ctx.save();
  ctx.font = `600 ${Math.round(32 * scale)}px ${UI}`;
  const width = ctx.measureText(value).width + 52 * scale;
  ctx.restore();
  return width;
}

/** A pill; on a light story the cancelled one is drawn in the change template's soft rose. */
function drawChip(
  ctx: CanvasRenderingContext2D,
  label: NonNullable<StorySlot["label"]>,
  x: number,
  middle: number,
  scale: number,
  from: "left" | "right" = "left",
  light = false,
) {
  const width = chipWidth(ctx, label.text, scale);
  const height = 60 * scale;
  const left = from === "left" ? x : x - width;
  const [fill, ink] = light ? ["#f6e1dd", "#9b3b30"] : chipColors[label.tone];
  ctx.save();
  ctx.fillStyle = fill;
  roundRect(ctx, left, middle - height / 2, width, height, height / 2);
  ctx.fill();
  ctx.restore();
  text(ctx, label.text, left + width / 2, middle + 11 * scale, {
    font: `600 ${Math.round(32 * scale)}px ${UI}`,
    align: "center",
    color: ink,
  });
}

function strike(ctx: CanvasRenderingContext2D, from: number, to: number, y: number, weight: number, color = "#ffffff") {
  ctx.save();
  ctx.fillStyle = color;
  roundRect(ctx, from - 8, y - weight / 2, to - from + 16, weight, weight / 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}

/** Mixes two "#rrggbb" colours: 0 is the first, 1 the second. */
export function mix(from: string, to: string, amount: number): string {
  const a = rgb(from);
  const b = rgb(to);
  const channel = (index: number) =>
    Math.round(a[index]! + (b[index]! - a[index]!) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function alpha(color: string, value: number): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r},${g},${b},${value})`;
}

function rgb(color: string): [number, number, number] {
  const hex = color.replace("#", "");
  return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}

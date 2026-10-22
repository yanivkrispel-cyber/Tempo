/**
 * The milestone card drawn with Canvas 2D at 1080x1920 (docs/37 section 8.2, mockup "אבן דרך" in
 * docs/design/mockups/marketing-2026-10-19/studio-stories.html): the count large, her line under it and four numbers.
 * Drawn on her phone only; nothing is uploaded, and it leaves the device only when she shares it herself.
 */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;
const SIDE = 76;

export const DISPLAY_FACE = '"Frank Ruhl Libre", "David Libre", Georgia, serif';
export const UI_FACE = '"IBM Plex Sans Hebrew", "Heebo", "Segoe UI", system-ui, sans-serif';
const CONDENSED = '"Karantina", "IBM Plex Sans Hebrew", sans-serif';
const GROUND = "#2b2420";
const ACCENT = "#d7aa9c";

const KARANTINA = "https://fonts.googleapis.com/css2?family=Karantina:wght@700&display=swap";

export interface MilestoneCardInput {
  count: number;
  /** "השיעור החמישים שלי". */
  line: string;
  /** "סטודיו נגה · אוקטובר". */
  eyebrow: string;
  stats: readonly { value: string; label: string }[];
}

/** Loads the card's faces before drawing, or the canvas keeps a system font. The condensed face is added here only. */
export async function loadCardFonts(): Promise<void> {
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
    [`500 100px ${DISPLAY_FACE}`, `500 36px ${UI_FACE}`, `600 36px ${UI_FACE}`, `700 100px ${CONDENSED}`].map((font) =>
      document.fonts.load(font, sample).catch(() => []),
    ),
  );
}

/** Splits text into lines that fit `width`, at spaces. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Shrinks the font until the text fits `width` (a long studio or instructor name). */
export function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, face: string, width: number) {
  let px = size;
  ctx.font = `${weight} ${px}px ${face}`;
  while (px > 24 && ctx.measureText(text).width > width) {
    px -= 4;
    ctx.font = `${weight} ${px}px ${face}`;
  }
}

export function drawMilestone(ctx: CanvasRenderingContext2D, input: MilestoneCardInput): void {
  const right = CARD_WIDTH - SIDE;
  const inner = CARD_WIDTH - SIDE * 2;
  ctx.save();
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.fillStyle = ACCENT;
  fitText(ctx, input.eyebrow, 600, 39, UI_FACE, inner);
  ctx.fillText(input.eyebrow, right, 200);

  // The count is digits: drawn left to right, its right edge on the text's edge.
  ctx.direction = "ltr";
  ctx.font = `700 690px ${CONDENSED}`;
  ctx.fillText(String(input.count), CARD_WIDTH - 54, 770);
  ctx.direction = "rtl";

  ctx.fillStyle = "#fff";
  ctx.font = `500 104px ${DISPLAY_FACE}`;
  const lines = wrap(ctx, input.line, inner);
  lines.forEach((line, at) => ctx.fillText(line, right, 880 + at * 106));

  const top = 880 + (lines.length - 1) * 106 + 140;
  const gap = 44;
  const column = (inner - gap) / 2;
  input.stats.forEach((stat, at) => {
    const x = right - (at % 2) * (column + gap);
    const y = top + Math.floor(at / 2) * 230;
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(x - column, y, column, 4);
    ctx.fillStyle = "#fff";
    fitText(ctx, stat.value, 700, 97, CONDENSED, column);
    ctx.fillText(stat.value, x, y + 106);
    ctx.globalAlpha = 0.8;
    fitText(ctx, stat.label, 500, 36, UI_FACE, column);
    ctx.fillText(stat.label, x, y + 160);
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

/** The card as a PNG file, ready for the share sheet or a download; null when the browser cannot draw. */
export async function milestoneFile(input: MilestoneCardInput): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  await loadCardFonts();
  drawMilestone(ctx, input);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], `tempo-${input.count}.png`, { type: "image/png" }) : null;
}

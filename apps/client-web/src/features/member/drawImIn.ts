import { CARD_HEIGHT, CARD_WIDTH, DISPLAY_FACE, fitText, loadCardFonts, UI_FACE } from "./drawMilestone";

/**
 * "אני בפנים", the member's card after a booking (docs/37 section 8.1, M-5; mockup "אני בפנים" in
 * docs/design/mockups/marketing-2026-10-19/studio-stories.html): a ticket for the class on the studio's accent.
 * It names the class, the time, her spot, the instructor only when their profile is public (M-14) and the studio,
 * and never a member, herself included: her first name travels only in her link's invite (SL-8, C-1).
 * Drawn on her phone only; it leaves the device only when she shares or saves it herself.
 */
export interface ImInCardInput {
  className: string;
  /** "שני 18:00". */
  when: string;
  spotLabel: string | null;
  /** The instructor's name from the public class only (M-14); null hides the line. */
  instructor: string | null;
  studioName: string;
  /** "נשארו 2 מקומות" when few are left, else null. */
  footnote: string | null;
  /** The studio's Instagram handle without @ (M-15); null shows no tag. */
  handle: string | null;
  /** The accent's light brand colour, "#56735b". */
  accent: string;
  /** The class cover, already loaded; null draws the accent in its place. */
  photo: CanvasImageSource | null;
}

const CW = CARD_WIDTH / 100; // One container-width unit of the mockup.
const INK = "#2b2420";
const MUTED = "#8a7f76";
const PAPER = "#fbfaf8";
const TAG = "#b04a7c";

/** The grid's cells in reading order; the spot and the instructor only when there are ones to say. */
export function imInCells(input: ImInCardInput): { label: string; value: string }[] {
  return [
    { label: "מתי", value: input.when },
    input.spotLabel ? { label: "מכשיר", value: `מספר ${input.spotLabel}` } : null,
    input.instructor ? { label: "עם", value: input.instructor } : null,
    { label: "איפה", value: input.studioName },
  ].filter((cell): cell is { label: string; value: string } => cell !== null);
}

/** Mixes a #rrggbb colour toward black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const mix = (channel: number) => Math.round(channel + (target - channel) * Math.abs(amount));
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(mix);
  return `#${((1 << 24) | (r! << 16) | (g! << 8) | b!).toString(16).slice(1)}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPhoto(
  ctx: CanvasRenderingContext2D,
  photo: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const size = photo as { width?: unknown; height?: unknown; naturalWidth?: number; naturalHeight?: number };
  const pw = size.naturalWidth ?? (typeof size.width === "number" ? size.width : 0);
  const ph = size.naturalHeight ?? (typeof size.height === "number" ? size.height : 0);
  if (!pw || !ph) return;
  const scale = Math.max(w / pw, h / ph);
  ctx.drawImage(photo, x + (w - pw * scale) / 2, y + (h - ph * scale) / 2, pw * scale, ph * scale);
}

export function drawImIn(ctx: CanvasRenderingContext2D, input: ImInCardInput): void {
  ctx.save();
  ctx.direction = "rtl";
  ctx.textBaseline = "alphabetic";

  const ground = ctx.createLinearGradient(0, 0, CARD_WIDTH * 0.55, CARD_HEIGHT);
  ground.addColorStop(0, input.accent);
  ground.addColorStop(1, shade(input.accent, -0.45));
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.textAlign = "center";
  ctx.fillStyle = shade(input.accent, 0.82);
  ctx.font = `900 ${13 * CW}px ${DISPLAY_FACE}`;
  ctx.fillText("אני בפנים", CARD_WIDTH / 2, 27 * CW);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `500 ${4 * CW}px ${UI_FACE}`;
  ctx.fillText("מי מצטרפת?", CARD_WIDTH / 2, 35 * CW);

  // The ticket.
  const left = 9 * CW;
  const width = CARD_WIDTH - 2 * left;
  const top = 44 * CW;
  const pad = 4.4 * CW;
  const photoHeight = 40 * CW;
  const cells = imInCells(input);
  const rows = Math.ceil(cells.length / 2);
  const height = photoHeight + pad + 7 * CW + rows * 10 * CW + 14 * CW + pad;
  ctx.save();
  roundRect(ctx, left, top, width, height, 5 * CW);
  ctx.clip();
  ctx.fillStyle = PAPER;
  ctx.fillRect(left, top, width, height);
  // Without a cover, a soft wash of the accent holds the photo's place.
  const wash = ctx.createLinearGradient(left, top, left + width, top + photoHeight);
  wash.addColorStop(0, shade(input.accent, 0.35));
  wash.addColorStop(1, shade(input.accent, 0.7));
  ctx.fillStyle = wash;
  ctx.fillRect(left, top, width, photoHeight);
  if (input.photo) drawPhoto(ctx, input.photo, left, top, width, photoHeight);
  ctx.restore();

  const right = left + width - pad;
  const inner = width - 2 * pad;
  ctx.textAlign = "right";
  ctx.fillStyle = INK;
  let y = top + photoHeight + pad + 6 * CW;
  fitText(ctx, input.className, 900, 7 * CW, DISPLAY_FACE, inner);
  ctx.fillText(input.className, right, y);

  const gap = 3 * CW;
  const column = (inner - gap) / 2;
  y += 4 * CW;
  cells.forEach((cell, at) => {
    const x = right - (at % 2) * (column + gap);
    const cellTop = y + Math.floor(at / 2) * 10 * CW;
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${3 * CW}px ${UI_FACE}`;
    ctx.fillText(cell.label, x, cellTop + 3 * CW);
    ctx.fillStyle = INK;
    fitText(ctx, cell.value, 700, 4.4 * CW, UI_FACE, column);
    ctx.fillText(cell.value, x, cellTop + 8 * CW);
  });

  // The perforation, then the footnote in the accent.
  const perf = top + height - pad - 6.4 * CW;
  ctx.strokeStyle = "#cfc5bb";
  ctx.lineWidth = 0.5 * CW;
  ctx.setLineDash([2 * CW, 1.4 * CW]);
  ctx.beginPath();
  ctx.moveTo(left, perf);
  ctx.lineTo(left + width, perf);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = input.accent;
  ctx.font = `600 ${3.4 * CW}px ${UI_FACE}`;
  ctx.fillText(input.footnote ?? "בואי איתי", right, perf + 6.4 * CW);

  if (input.handle) {
    const tag = `@${input.handle}`;
    ctx.direction = "ltr";
    ctx.font = `600 ${3.8 * CW}px ${UI_FACE}`;
    const tagWidth = ctx.measureText(tag).width + 6 * CW;
    const tagHeight = 7.4 * CW;
    const tagTop = CARD_HEIGHT - 22 * CW - tagHeight;
    roundRect(ctx, (CARD_WIDTH - tagWidth) / 2, tagTop, tagWidth, tagHeight, 2 * CW);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.fillStyle = TAG;
    ctx.textAlign = "center";
    ctx.fillText(tag, CARD_WIDTH / 2, tagTop + 5.1 * CW);
  }
  ctx.restore();
}

/**
 * Loads a presigned cover for the canvas. The media bucket answers GET with CORS for the apps' origins, so the canvas
 * stays exportable; anything else (no cover, an expired link, a network error) draws the accent instead.
 */
export async function loadCover(url: string | null | undefined): Promise<CanvasImageSource | null> {
  if (!url || typeof Image === "undefined") return null;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

/** The card as a PNG file for the share sheet or a download; null when the browser cannot draw. */
export async function imInFile(input: Omit<ImInCardInput, "photo">, coverUrl: string | null): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const [photo] = await Promise.all([loadCover(coverUrl), loadCardFonts()]);
  drawImIn(ctx, { ...input, photo });
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      // A tainted canvas (a cover served without CORS) refuses to export.
      resolve(null);
    }
  });
  return blob ? new File([blob], "tempo-class.png", { type: "image/png" }) : null;
}

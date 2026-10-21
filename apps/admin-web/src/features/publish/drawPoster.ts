import qrcode from "qrcode-generator";
import { DISPLAY, fit, mix, roundRect, UI, wrap } from "./drawStory";

/**
 * The studio's A4 poster for the wall and the front desk (docs/37 section 8.6, MO7): drawn on the device at 300 dpi,
 * downloaded and printed by the owner. The QR leads to the studio's poster link, so sign-ups from the wall are counted
 * under "poster".
 */
export const POSTER_WIDTH = 2480;
export const POSTER_HEIGHT = 3508;
export const POSTER_HEADLINE = "סרקי והירשמי לשיעור";

const SIDE = 200;
const INK = "#2b2420";
const TILE = 1500;
const TILE_TOP = 1420;

export interface PosterInput {
  studioName: string;
  /** The studio's accent ground (docs/35 W-1). */
  accent: string;
  /** "3 שיעורי ניסיון ב-99 ₪", when the studio lists a newcomers' offer. */
  offerLine: string | null;
  /** The poster link; until it exists the tile says where the code will be. */
  url: string | null;
}

export function drawPoster(ctx: CanvasRenderingContext2D, input: PosterInput): void {
  ctx.save();
  ctx.clearRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const gradient = ctx.createLinearGradient(0, 0, 0, POSTER_HEIGHT);
  gradient.addColorStop(0, input.accent);
  gradient.addColorStop(1, mix(input.accent, "#000000", 0.35));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  const middle = POSTER_WIDTH / 2;
  const width = POSTER_WIDTH - 2 * SIDE;
  const light = mix(input.accent, "#ffffff", 0.82);
  ctx.fillStyle = "#ffffff";

  ctx.font = `600 92px ${UI}`;
  ctx.globalAlpha = 0.9;
  ctx.fillText(fit(ctx, input.studioName, width), middle, 330);
  ctx.globalAlpha = 1;

  const headline = `500 250px ${DISPLAY}`;
  const lines = wrap(ctx, POSTER_HEADLINE, headline, width).slice(0, 2);
  ctx.font = headline;
  lines.forEach((line, index) => ctx.fillText(line, middle, 720 + index * 270));

  if (input.offerLine) {
    ctx.font = `700 96px ${UI}`;
    ctx.fillStyle = light;
    ctx.fillText(fit(ctx, `פעם ראשונה? ${input.offerLine}`, width), middle, 720 + lines.length * 270 + 60);
  }

  const left = middle - TILE / 2;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, left, TILE_TOP, TILE, TILE, 90);
  ctx.fill();
  if (input.url) drawQr(ctx, input.url, left, TILE_TOP);
  else {
    ctx.fillStyle = mix(INK, "#ffffff", 0.45);
    ctx.font = `500 80px ${UI}`;
    ctx.fillText("הקוד ייווצר בהורדה", middle, TILE_TOP + TILE / 2 + 28);
  }

  ctx.fillStyle = "#ffffff";
  if (input.url) {
    ctx.font = `500 76px ${UI}`;
    ctx.direction = "ltr";
    ctx.globalAlpha = 0.9;
    ctx.fillText(fit(ctx, address(input.url), width), middle, TILE_TOP + TILE + 170);
    ctx.direction = "rtl";
    ctx.globalAlpha = 1;
  }
  ctx.font = `500 84px ${UI}`;
  ctx.fillText("כל השיעורים של השבוע, וההרשמה בטלפון", middle, POSTER_HEIGHT - 260);
  ctx.restore();
}

/** The code inside the white tile, with a quiet zone of at least four modules on every side. */
function drawQr(ctx: CanvasRenderingContext2D, value: string, left: number, top: number) {
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();
  const count = code.getModuleCount();
  const module = Math.floor(TILE / (count + 8));
  const offset = Math.floor((TILE - module * count) / 2);
  ctx.fillStyle = INK;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col))
        ctx.fillRect(left + offset + col * module, top + offset + row * module, module, module);
    }
  }
}

/** "studio.example/s/neshima": the page to type in by hand. The code itself carries the poster's source. */
function address(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

import { useRef, useState } from "react";
import { Button, Icon, useToast, type IconName } from "../../shared/design-system";
import { mix } from "./drawStory";
import styles from "./publish.module.css";

/** One cover per highlight the studio keeps on its Instagram profile (docs/37 section 8.7). */
const covers: readonly { id: string; name: string; icon: IconName }[] = [
  { id: "timetable", name: "מערכת שעות", icon: "calendar" },
  { id: "prices", name: "מחירון", icon: "credit-card" },
  { id: "about", name: "עלינו", icon: "home" },
  { id: "instructors", name: "הצוות", icon: "users" },
  { id: "directions", name: "איך מגיעים", icon: "map-pin" },
  { id: "reviews", name: "המלצות", icon: "star" },
];

const WIDTH = 1080;
const HEIGHT = 1920;
const RADIUS = 330;
const ICON = 340;

/**
 * "כיסויי היילייטס" (docs/37 section 8.7, MO7): six 1080x1920 covers in the studio's accent, each one of the design
 * system's icons in a circle. Instagram crops a highlight cover to the circle in its middle, so everything sits there.
 * Each downloads on its own; there is no zip and no link, since a cover leads nowhere.
 */
export function HighlightCovers({ slug, accent }: { slug: string; accent: string }) {
  const toast = useToast();
  const icons = useRef(new Map<string, SVGSVGElement>());
  const [busy, setBusy] = useState<string | null>(null);

  async function save(cover: (typeof covers)[number]) {
    setBusy(cover.id);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext("2d");
      const icon = icons.current.get(cover.id);
      if (ctx && icon) await drawCover(ctx, accent, icon);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        toast.show({ tone: "danger", icon: "info", message: "לא הצלחנו להכין את התמונה" });
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}-highlight-${cover.id}.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.show({ tone: "success", icon: "check", message: `הכיסוי ירד: ${cover.name}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`tp-card tp-stack ${styles.covers}`} aria-label="כיסויי היילייטס">
      <h2>כיסויי היילייטס</h2>
      <p className="tp-muted">שישה כיסויים בצבע של הסטודיו, לשמור בטלפון ולהעלות להיילייטס באינסטגרם.</p>
      <ul className={styles.coverList}>
        {covers.map((cover) => (
          <li key={cover.id} className={styles.cover}>
            <span className={styles.coverArt} style={{ background: ground(accent) }}>
              <span className={styles.coverCircle}>
                <Icon
                  name={cover.icon}
                  ref={(node: SVGSVGElement | null) => {
                    if (node) icons.current.set(cover.id, node);
                    else icons.current.delete(cover.id);
                  }}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </span>
            </span>
            <span className={styles.coverName}>{cover.name}</span>
            <Button
              size="sm"
              variant="secondary"
              icon="arrow-down"
              aria-label={`הורדת הכיסוי: ${cover.name}`}
              loading={busy === cover.id}
              disabled={busy !== null && busy !== cover.id}
              onClick={() => void save(cover)}
            >
              הורדה
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ground(accent: string): string {
  return `linear-gradient(180deg, ${accent}, ${mix(accent, "#000000", 0.35)})`;
}

/** The accent, the circle and the icon, drawn from the same SVG the screen shows. */
async function drawCover(ctx: CanvasRenderingContext2D, accent: string, icon: SVGSVGElement) {
  const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  gradient.addColorStop(0, accent);
  gradient.addColorStop(1, mix(accent, "#000000", 0.35));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.beginPath();
  ctx.arc(WIDTH / 2, HEIGHT / 2, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.stroke();

  const svg = icon.cloneNode(true) as SVGSVGElement;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(ICON));
  svg.setAttribute("height", String(ICON));
  svg.removeAttribute("class");
  // An SVG from a blob of our own markup never taints the canvas, so the cover still exports.
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    ctx.drawImage(image, (WIDTH - ICON) / 2, (HEIGHT - ICON) / 2, ICON, ICON);
  } finally {
    URL.revokeObjectURL(url);
  }
}

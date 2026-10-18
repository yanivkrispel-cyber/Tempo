#!/usr/bin/env node
/**
 * Draws both apps' icons from the brand mark (board #347, P-1): `docs/design/brand/tempo-mark.svg` on paper for the
 * member app, `tempo-mark-on-brand.svg` on sage-deep for the console. Chromium (Playwright's, already in this
 * workspace) renders each size, so no image library is needed. The PNGs are committed; run this again only when the
 * mark or the colours change:
 *
 *   pnpm --filter @tempo/e2e exec node scripts/pwa-icons.mjs
 *
 * Sizes, per app in `apps/<app>/public/`: `icons/icon-192.png` and `icon-512.png` (purpose any: a rounded square),
 * `icons/icon-maskable-512.png` (full bleed, the mark inside the 80% safe circle), `apple-touch-icon.png` (180,
 * full bleed: iOS rounds it itself), `favicon-32.png` and `favicon.svg`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const brand = join(root, "docs/design/brand");

const apps = [
  { app: "client-web", mark: "tempo-mark.svg", background: "#fbfaf8" },
  { app: "admin-web", mark: "tempo-mark-on-brand.svg", background: "#56735b" },
];

// The share of the icon's width the mark's 200-unit box takes. Maskable: at most 75% keeps the leaf tips inside the
// safe circle (docs/design/brand/README.md); 70% leaves a margin.
const rounded = { box: 0.72, radius: 0.225 };
const outputs = [
  { file: "icons/icon-192.png", size: 192, ...rounded },
  { file: "icons/icon-512.png", size: 512, ...rounded },
  { file: "icons/icon-maskable-512.png", size: 512, box: 0.7, radius: 0 },
  { file: "apple-touch-icon.png", size: 180, box: 0.72, radius: 0 },
  { file: "favicon-32.png", size: 32, box: 0.8, radius: 0.22 },
];

/** The mark's own paths, without its outer <svg>. */
function paths(svg) {
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];
  if (!inner) throw new Error("the mark is not an <svg>");
  return inner.trim();
}

/** One square SVG: the background (rounded or full bleed) and the mark centred at `box` of the width. */
function icon(markSvg, background, { box, radius }) {
  const scale = box;
  const offset = (200 - 200 * scale) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">` +
    `<rect width="200" height="200" rx="${200 * radius}" fill="${background}"/>` +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">${paths(markSvg)}</g></svg>`
  );
}

const browser = await chromium.launch();
try {
  for (const { app, mark, background } of apps) {
    const markSvg = readFileSync(join(brand, mark), "utf8");
    const publicDir = join(root, "apps", app, "public");
    mkdirSync(join(publicDir, "icons"), { recursive: true });
    writeFileSync(join(publicDir, "favicon.svg"), icon(markSvg, background, { box: 0.8, radius: 0.22 }) + "\n");
    for (const { file, size, ...shape } of outputs) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      const svg = icon(markSvg, background, shape);
      await page.setContent(
        `<html><body style="margin:0;background:transparent">` +
          `<img alt="" width="${size}" height="${size}" style="display:block" ` +
          `src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`,
      );
      await page.locator("img").evaluate((image) => image.decode());
      writeFileSync(join(publicDir, file), await page.screenshot({ omitBackground: true }));
      await page.close();
      console.log(`${app}/public/${file} ${size}x${size}`);
    }
  }
} finally {
  await browser.close();
}

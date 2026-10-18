// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Chrome installs a web app only with a 192 and a 512 PNG icon (board #347, P-1 and P-2).
type Image = { src: string; sizes: string; type: string; purpose?: string; form_factor?: string };
type Manifest = Record<string, unknown> & {
  id: string;
  start_url: string;
  scope: string;
  icons: Image[];
  screenshots: Image[];
  shortcuts: { name: string; url: string; icons?: Image[] }[];
};

const publicDir = new URL("../../public/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.webmanifest", publicDir), "utf8")) as Manifest;
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

/** Width and height from a PNG's IHDR chunk, or null when the file is not a PNG. */
function pngSize(src: string): [number, number] | null {
  const file = new URL(src.replace(/^\//, ""), publicDir);
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  if (bytes.subarray(1, 4).toString("ascii") !== "PNG") return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const declared = (image: Image) => image.sizes.split("x").map(Number);

describe("the console's manifest", () => {
  it("names the app in Hebrew with a stable id, on Warm Glass paper", () => {
    expect(manifest).toMatchObject({
      id: "/",
      name: "Tempo · ניהול הסטודיו",
      short_name: "Tempo ניהול",
      lang: "he",
      dir: "rtl",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#fbfaf8",
      theme_color: "#fbfaf8",
    });
    expect(manifest.description).toMatch(/[א-ת]/);
  });

  it("has a 192 and a 512 icon, and a maskable 512, each a PNG of its declared size", () => {
    const keys = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose ?? "any"}`);
    expect(keys).toEqual(expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]));
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(pngSize(icon.src), icon.src).toEqual(declared(icon));
    }
  });

  it("has a narrow and a wide screenshot, each of its declared size", () => {
    expect(manifest.screenshots.map((shot) => shot.form_factor).sort()).toEqual(["narrow", "wide"]);
    for (const shot of manifest.screenshots) expect(pngSize(shot.src), shot.src).toEqual(declared(shot));
  });

  it("offers today and the door scan as shortcuts, inside the app's scope", () => {
    expect(manifest.shortcuts.map((shortcut) => [shortcut.name, shortcut.url])).toEqual([
      ["היום בסטודיו", "/"],
      ["סריקת כניסה", "/?open=scan"],
    ]);
    for (const shortcut of manifest.shortcuts)
      for (const icon of shortcut.icons ?? []) expect(pngSize(icon.src), icon.src).toEqual(declared(icon));
  });
});

describe("index.html icons", () => {
  it("links the favicon, a 32 px fallback, the iPhone home-screen icon and the theme colour", () => {
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="theme-color" content="#fbfaf8" />');
    expect(pngSize("/favicon-32.png")).toEqual([32, 32]);
    expect(pngSize("/apple-touch-icon.png")).toEqual([180, 180]);
    expect(existsSync(new URL("favicon.svg", publicDir))).toBe(true);
  });
});

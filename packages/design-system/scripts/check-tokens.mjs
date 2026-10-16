// Guards the token file: shape, unique names, and WCAG contrast for every text/ground pair
// named in a token's usage. Exit code 1 on any failure so CI blocks a regression.
// Pairs that reproduce the reference image exactly (white text on sage / rose / taupe, per Kris's
// one-to-one decision of 2026-10-13) are listed under SOURCE_EXACT: they are reported, never fail.
// Run: node scripts/check-tokens.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(resolve(here, "../tokens/tokens.json"), "utf8"));
const failures = [];
const warnings = [];

// --- shape and uniqueness -------------------------------------------------
const seen = new Map();
for (const [fam, val] of Object.entries(t)) {
  if (!val?.tokens) continue;
  for (const tok of val.tokens) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(tok.name)) failures.push(`${fam}/${tok.name}: bad name`);
    if (seen.has(tok.name)) failures.push(`${tok.name}: duplicate (also in ${seen.get(tok.name)})`);
    seen.set(tok.name, fam);
    if (!tok.usage) failures.push(`${fam}/${tok.name}: missing usage note`);
  }
}

// --- contrast --------------------------------------------------------------
const hex = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const color = Object.fromEntries(t.color.tokens.map((x) => [x.name, x.value]));
const themes = t.color.themes.map((x) => x.id);

// text token -> grounds it must read on, with the minimum ratio (4.5 text, 3 large/marks)
const pairs = [
  ["ink", ["canvas", "surface", "surface-sand", "surface-sunken", "surface-hover", "surface-deep"], 4.5],
  ["ink-muted", ["canvas", "surface", "surface-sand", "surface-sunken"], 4.5],
  ["ink-faint", ["surface"], 3],
  ["ink-inverse", ["ink"], 4.5],
  ["line-strong", ["surface"], 3],
  ["selected-ink", ["selected"], 4.5],
  ["selected-line", ["selected"], 1.1],
  ["brand-ink", ["brand-soft", "surface", "canvas", "surface-sand"], 4.5],
  ["rose-ink", ["rose-soft", "surface"], 4.5],
  ["taupe-ink", ["taupe-soft", "surface", "canvas"], 4.5],
  ["info-ink", ["info-soft", "surface"], 4.5],
  ["success-ink", ["success-soft", "surface"], 4.5],
  ["warning-ink", ["warning-soft", "surface"], 4.5],
  ["danger-ink", ["danger-soft", "surface"], 4.5],
  ["on-danger", ["danger-strong"], 4.5],
  ["brand", ["canvas", "surface-sand"], 1.5],
  ["icon-dark", ["sand", "surface"], 4.5],
  ...["sage", "rose", "taupe", "blue", "amber", "mauve"].map((c) => [`cat-${c}-ink`, [`cat-${c}-soft`], 4.5]),
  ...["sage", "rose", "taupe", "blue", "amber", "mauve"].map((c) => [`cat-${c}`, [`cat-${c}-soft`], 1.5]),
];
// reference-exact pairs: reported, never fail
const SOURCE_EXACT = [
  ["focus", ["canvas", "surface", "surface-sand"], 3],
  ["on-brand", ["brand", "brand-hover", "brand-pressed"], 4.5],
  ["on-rose", ["rose", "rose-deep"], 4.5],
  ["on-taupe", ["taupe", "taupe-deep"], 4.5],
];
const rows = [];
const check = (list, soft) => {
  for (const [fg, grounds, min] of list) {
    for (const bg of grounds) {
      for (const theme of themes) {
        const a = color[fg]?.[theme] ?? color[fg]?.light;
        const b = color[bg]?.[theme] ?? color[bg]?.light;
        if (!a || !b) {
          failures.push(`${fg} on ${bg}: unknown token`);
          continue;
        }
        if (a.length > 7 || b.length > 7) continue; // skip alpha values
        const r = ratio(a, b);
        rows.push(`${r.toFixed(2).padStart(6)}  ${theme.padEnd(5)}  ${fg} on ${bg}${soft ? "  (source-exact)" : ""}`);
        if (r < min) (soft ? warnings : failures).push(`${theme}: ${fg} on ${bg} = ${r.toFixed(2)} (< ${min})`);
      }
    }
  }
};
check(pairs, false);
check(SOURCE_EXACT, true);

console.log(rows.join("\n"));
if (warnings.length)
  console.log(
    "\nSOURCE-EXACT (kept as in the reference image, not AA):\n" + warnings.map((f) => "  - " + f).join("\n"),
  );
if (failures.length) {
  console.error("\nFAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log(`\nOK: ${seen.size} tokens, ${rows.length} contrast pairs checked.`);

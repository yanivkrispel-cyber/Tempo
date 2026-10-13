// Guards the token file: shape, unique names, and WCAG contrast for every text/ground pair
// named in a token's usage. Exit code 1 on any failure so CI blocks a regression.
// Run: node scripts/check-tokens.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(resolve(here, "../tokens/tokens.json"), "utf8"));
const failures = [];

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
  ["ink", ["canvas", "surface", "surface-sunken", "surface-hover"], 4.5],
  ["brand-light", ["canvas"], 3],
  ["on-brand", ["brand-light"], 3],
  ["ink-muted", ["canvas", "surface", "surface-sunken"], 4.5],
  ["ink-faint", ["surface"], 3],
  ["ink-inverse", ["ink"], 4.5],
  ["focus", ["canvas", "surface", "surface-sunken"], 3],
  ["line-strong", ["surface"], 3],
  ["on-brand", ["brand", "brand-hover", "brand-pressed"], 4.5],
  ["brand-ink", ["brand-soft", "surface", "canvas"], 4.5],
  ["info-ink", ["info-soft", "surface"], 4.5],
  ["success-ink", ["success-soft", "surface"], 4.5],
  ["warning-ink", ["warning-soft", "surface"], 4.5],
  ["danger-ink", ["danger-soft", "surface"], 4.5],
  ["on-danger", ["danger"], 4.5],
  ["brand", ["canvas", "surface"], 3],
  ["danger", ["surface"], 3],
  ...["teal", "blue", "violet", "pink", "amber", "green"].map((c) => [`cat-${c}-ink`, [`cat-${c}-soft`], 4.5]),
  ...["teal", "blue", "violet", "pink", "amber", "green"].map((c) => [`cat-${c}`, [`cat-${c}-soft`], 3]),
];
const rows = [];
for (const [fg, grounds, min] of pairs) {
  for (const bg of grounds) {
    for (const theme of themes) {
      const a = color[fg]?.[theme] ?? color[fg]?.light;
      const b = color[bg]?.[theme] ?? color[bg]?.light;
      if (!a || !b) { failures.push(`${fg} on ${bg}: unknown token`); continue; }
      if (a.length > 7 || b.length > 7) continue; // skip alpha values
      const r = ratio(a, b);
      rows.push(`${r.toFixed(2).padStart(6)}  ${theme.padEnd(5)}  ${fg} on ${bg}`);
      if (r < min) failures.push(`${theme}: ${fg} on ${bg} = ${r.toFixed(2)} (< ${min})`);
    }
  }
}

console.log(rows.join("\n"));
if (failures.length) {
  console.error("\nFAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log(`\nOK: ${seen.size} tokens, ${rows.length} contrast pairs checked.`);

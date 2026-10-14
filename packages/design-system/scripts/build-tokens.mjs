// Generates css/tokens.css from tokens/tokens.json.
// No dependencies. Run: node scripts/build-tokens.mjs
//
// Output shape:
//   :root                  every token, light values, --font-* families, --text-* type styles
//   [data-theme="dark"]    dark values (on <html>, or on any wrapper to theme a region)
//   .text-<style> classes  one per type style
// Light is the product's face (Kris, 2026-10-13): nothing set = light. The OS theme is NOT followed;
// dark applies only when the app sets data-theme="dark" explicitly from a user choice.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../tokens/tokens.json");
const out = resolve(here, "../css/tokens.css");

const t = JSON.parse(readFileSync(src, "utf8"));
const themes = t.color.themes.map((x) => x.id);
const [first, ...rest] = themes;

const cssName = (n) => "--" + n.replace(/\./g, "\\.");
const themed = (family) =>
  (t[family]?.tokens ?? []).filter((tok) => typeof tok.value === "object");
const flat = (family) =>
  (t[family]?.tokens ?? []).map((tok) => `  ${cssName(tok.name)}: ${typeof tok.value === "object" ? tok.value[first] : tok.value};`);

const valueFor = (tok, theme) =>
  typeof tok.value === "object" ? (tok.value[theme] ?? tok.value[first]) : tok.value;

const otherFamilies = Object.keys(t).filter(
  (k) => !["name", "version", "meta", "color", "type", "shadow"].includes(k) && t[k]?.tokens
);

const lines = [];
lines.push(`/* ${t.name} — generated from tokens/tokens.json by scripts/build-tokens.mjs. Do not edit by hand. */`);
lines.push(`:root {`);
lines.push(`  color-scheme: ${first};`);
lines.push(`  /* color */`);
lines.push(...flat("color"));
lines.push(`  /* shadow */`);
lines.push(...flat("shadow"));
for (const fam of otherFamilies) {
  lines.push(`  /* ${fam} */`);
  lines.push(...flat(fam));
}
lines.push(`  /* type */`);
for (const [key, stack] of Object.entries(t.type.families)) lines.push(`  --font-${key}: ${stack};`);
lines.push(`}`);

for (const theme of rest) {
  const block = [];
  block.push(`  color-scheme: ${theme};`);
  for (const fam of ["color", "shadow"]) {
    for (const tok of themed(fam)) block.push(`  ${cssName(tok.name)}: ${valueFor(tok, theme)};`);
  }
  lines.push(`[data-theme="${theme}"] {`);
  lines.push(...block);
  lines.push(`}`);
}

lines.push(`/* type styles */`);
for (const group of t.type.groups) {
  for (const s of group.styles) {
    const fam = `var(--font-${s.family ?? group.family})`;
    const parts = [
      `font-family: ${fam}`,
      `font-size: ${s.fontSize}`,
      `line-height: ${s.lineHeight}`,
      `font-weight: ${s.fontWeight}`,
    ];
    if (s.letterSpacing) parts.push(`letter-spacing: ${s.letterSpacing}`);
    lines.push(`.text-${s.name} { ${parts.join("; ")}; }`);
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out} (${lines.length} lines, themes: ${themes.join(", ")})`);

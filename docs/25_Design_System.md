# Design System

> **Status:** Baseline v0.3 (Neo-Tactile tokens and CSS primitives matched to the reference image, 2026-10-13)  
> **Audience:** Product, Engineering, Design, AI coding agents  
> **Scope rule:** The design system is industry-neutral. Vertical-specific visuals (a studio's class categories, a clinic's treatment colors) map onto the generic category and status tokens; they never add tokens of their own.  
> **Decision policy:** Statements marked **Decision** are normative.

## 1. Where it lives

| What | Where |
|---|---|
| Tokens (source of truth) | `packages/design-system/tokens/tokens.json` |
| Generated CSS, base layer, primitives | `packages/design-system/css/` |
| Local specimen (all components, RTL, light/dark) | `packages/design-system/docs/specimen.html` |
| Browsable reference with live previews | https://claude.ai/artifact/4MSvEKktJR25A76416N5nC |
| The four candidate directions and why this one | https://claude.ai/artifact/5yhLE2tBY7QfkkDq3ciqou |
| Reference images the direction was derived from | `C:\Dev\Tempo-Design` (31 images, outside the repo) |

**Decision:** The package is consumed by all three apps as `@tempo/design-system`. Apps keep React wrappers in
`src/shared/design-system/` that render the package's classes; they do not restyle them.

## 2. Direction

**Decision (Kris, 2026-10-13, final after two earlier passes):** the interface reproduces the reference image
`C:/Dev/Tempo-Design/9d607248922bb2053a1b000d3e7809c3.jpg` ("Neo-Tactile Soft UI") one to one, in colors and in
the design of every control.

- Palette sampled from the image: warm off-white page, cream and sand slabs, taupe base cards, sage as the only
  action color (mint glow on hover, inner shadow when pressed, taupe-grey when disabled), dusty rose for the slider
  and the single elevated card per screen, blue only for focus and selection.
- Shadows follow the image's four levels (none, soft inner, gentle lift, elevated float) plus the hover glow and
  the focus glow. Radii follow its steps (4 / 8 / 12, extended to 16 / 20 / 28). Borders 1 / 1.5 / 2 where it has
  them. Icons 16 / 20 / 24, line style.
- Type: Heebo for UI (closest Hebrew-complete grotesk to the image's face), IBM Plex Mono for IDs and code.
- Three text-on-fill pairs are kept exactly as the image draws them although they are under WCAG AA (white on
  sage 2.4:1, on rose 2.6:1, on taupe 2.8:1), as is the light-blue focus ring. They are flagged in the token notes
  and reported (not failed) by the contrast lint; labels on those fills stay at 15px+ and 600 weight. Every other
  text token meets AA on the grounds its note names.

Earlier passes (flat/tactile hybrid, teal Soft UI) are superseded; the options page records them. The June 2026
design in `C:/Dev/StudioPro/design` is superseded.

## 3. Themes

**Decision:** Light is the face of the product (Kris, 2026-10-13). Every screen, preview, mock and marketing
image is light. The generated CSS is light by default and does not follow the OS theme. Dark exists as a complete,
contrast-checked token set and is applied only when a user explicitly chooses it (`data-theme="dark"` on `<html>`,
persisted by the app); it must stay legible but it is not the design reference. The contrast check in
`scripts/check-tokens.mjs` runs on both themes and blocks CI on any text/ground pair under 4.5:1 (3:1 for borders,
icons and focus rings).

## 4. RTL

**Decision:** Hebrew RTL is the default. All CSS uses logical properties (`inset-inline-start`, `padding-inline`,
`margin-inline-start`); physical left/right is forbidden in app styles. Latin tokens inside Hebrew text are isolated
(`<bdi>` or `.tp-ltr`); code, IDs, phone numbers and emails are `dir="ltr"`. Numeric ranges are written in words.

## 5. Accessibility floor

- Text ≥ 4.5:1, marks ≥ 3:1, in both themes (enforced by the token check).
- Focus ring on every interactive element, 2px solid `--focus`, offset 2px.
- Touch targets ≥ 44px.
- Status never by hue alone: word + color, success and danger differ in lightness.
- `prefers-reduced-motion` collapses all transitions.

## 6. White label

The tenant brand resolver (see `18_White_Label.md`) may override `brand`, `brand-hover`, `brand-pressed`,
`brand-soft`, `brand-ink` and the logo. It must verify `on-brand` against the new `brand` at ≥ 4.5:1 and darken the
tenant color until it passes. All other tokens are platform-owned.

## 7. Component inventory (v0.1)

Button (sage default, cream secondary, ghost, rose CTA, danger, icon tile, loading, three sizes) · Field with Input, Select, Textarea, search
input · Toggle · Checkbox and Radio · Segmented control · Chip (status, category, count) · Card (flat, raised,
sunken, selected) · Stat tile and Progress ring · Progress bar · Avatar · Table · Tabs · Sidebar rail and expanded nav · Bottom tab bar · Banner ·
Toast · Dialog and bottom sheet · Skeleton · Empty state · Week schedule with event tiles · Class card.

Two composed reference screens live in `packages/design-system/docs/specimen.html`: the console's weekly schedule and
the member app home.

Not yet: date picker, time picker, dropdown menu, command palette, charts (use the `dataviz` guidance with these
tokens when they arrive), data grid virtualization.

## 8. Workflow

1. Change `tokens.json` → `pnpm --filter @tempo/design-system build` → commit both files.
2. New primitive → `components.css` + a block in `docs/specimen.html` + a preview in the reference artifact.
3. A React wrapper per primitive lands in each app when that app is scaffolded (Phase 1), typed props, no styles.

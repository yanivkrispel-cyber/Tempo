# Design System

> **Status:** Baseline v0.2 (Soft UI tokens and CSS primitives, 2026-10-13)  
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

**Decision (revised 2026-10-13, after the first flat/tactile hybrid was judged not premium enough):** Soft UI
everywhere, "one material, two directions".

- Every object is cut from the same light material as the page. Depth comes from a dual shadow (light from the
  top-start corner, shade toward the bottom-end), never from a border. Objects you touch or read are raised; wells you
  type into, tracks and banners are sunken. Row dividers are embossed hairlines.
- Radii are large (20 to 36px on slabs, pills on anything small), spacing is generous (card padding 24 to 32px),
  type is heavy at the top of the hierarchy (display 44/800, h1 28/700) and quiet below it.
- Brand color: a Tempo teal gradient (`brand-light` to `brand`) used on one or two things per screen: the primary
  button, the toggle on-state, today's date, the occupancy ring, the member app's "next class" card. Ink is deep navy.
- Type: Heebo for UI (full Hebrew, 400 to 800 on Google Fonts), IBM Plex Mono for IDs and code.
- Readability is locked by tokens, not by style: every text token meets WCAG AA on the grounds its usage note names,
  in both themes, enforced in CI.

Rejected on the way (recorded in the options page): the flat SaaS base (readable but generic), pastel lavender glass
(unreadable in dense screens, no white label), warm sage clay (clashes with tenant logos). The June 2026 design in
`C:/Dev/StudioPro/design` is superseded.

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

Button (primary gradient, secondary raised, ghost, danger, round icon button, three sizes) · Field with Input, Select, Textarea, search
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

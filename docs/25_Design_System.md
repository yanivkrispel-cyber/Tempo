# Design System

> **Status:** Baseline (foundation tokens and CSS primitives, 2026-10-13)  
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

**Decision:** "Flat base, tactile controls."

- The base is flat and crisp: white surfaces, hairline borders, small radii, navy ink. This is what makes a dense
  admin console readable, keeps WCAG AA trivial, and lets a tenant color replace one token for white label.
- The controls are tactile (soft raised, from the reference board's Soft UI images): primary button, toggle,
  segmented control, class card, progress ring. They sit on the canvas and cast a dual shadow. This is where the
  product feels like the reference images without paying the readability cost of full neumorphism.
- Brand color: Tempo teal (`brand` = `#1f7376` light / `#4fb3b6` dark). Ink: deep navy. Both come from the two
  palette boards in the reference set.
- Type: Heebo for UI (full Hebrew, five weights on Google Fonts), IBM Plex Mono for IDs and code.

Rejected on the way (recorded in the options page): pure neumorphism (contrast and dark mode), pastel lavender
glass (unreadable in dense screens, no white label), warm sage clay (clashes with tenant logos). The June 2026
design in `C:\Dev\StudioPro\design` is superseded and not referenced.

## 3. Themes

**Decision:** Light and dark ship together from day one. Every color token has both values; the contrast check in
`scripts/check-tokens.mjs` runs on both themes and blocks CI on any text/ground pair under 4.5:1 (3:1 for borders,
icons and focus rings). Nothing in the apps follows the OS theme blindly: the user's choice, when made, is stored
and wins.

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

Button (primary, secondary, outline, ghost, danger, icon, three sizes) · Field with Input, Select, Textarea, search
input · Toggle · Checkbox and Radio · Segmented control · Chip (status, category, count) · Card (flat, raised,
sunken, selected) · Stat tile and Progress ring · Progress bar · Avatar · Table · Tabs · Sidebar nav · Banner ·
Toast · Dialog and bottom sheet · Skeleton · Empty state · Week schedule with event blocks · Class card.

Not yet: date picker, time picker, dropdown menu, command palette, charts (use the `dataviz` guidance with these
tokens when they arrive), data grid virtualization.

## 8. Workflow

1. Change `tokens.json` → `pnpm --filter @tempo/design-system build` → commit both files.
2. New primitive → `components.css` + a block in `docs/specimen.html` + a preview in the reference artifact.
3. A React wrapper per primitive lands in each app when that app is scaffolded (Phase 1), typed props, no styles.

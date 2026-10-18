# Design System

> **Status:** v1.0 "Warm Glass" direction approved (D16, 2026-10-17); the package moves from v0.3 to v1.0 in step E7 of docs/33  
> **Audience:** Product, Engineering, Design, AI coding agents  
> **Scope rule:** The design system is industry-neutral. Vertical-specific visuals (a studio's class categories, a clinic's treatment colors) map onto the generic category and status tokens; they never add tokens of their own.  
> **Decision policy:** Statements marked **Decision** are normative.

## 1. Where it lives

| What                                             | Where                                               |
| ------------------------------------------------ | --------------------------------------------------- |
| Tokens (source of truth)                         | `packages/design-system/tokens/tokens.json`         |
| Generated CSS, base layer, primitives            | `packages/design-system/css/`                       |
| Local specimen (all components, RTL, light/dark) | `packages/design-system/docs/specimen.html`         |
| Browsable reference with live previews           | https://claude.ai/artifact/4MSvEKktJR25A76416N5nC   |
| The four candidate directions and why this one   | https://claude.ai/artifact/5yhLE2tBY7QfkkDq3ciqou   |
| The approved premium mockups and the research    | `docs/design/mockups/premium-2026-10-17/`, https://claude.ai/artifact/NUG1JaZVkZfPixXyeBTnNK |
| Reference images the direction was derived from  | `C:\Dev\Tempo-Design` (31 images, outside the repo) |

**Decision:** The package is consumed by all three apps as `@tempo/design-system`. Apps keep React wrappers in
`src/shared/design-system/` that render the package's classes; they do not restyle them.

## 2. Direction

**Decision (D16, Kris, 2026-10-17: "הדיזיין החדש מצוין"):** the product's look is **Warm Glass**, the premium
evolution of Neo-Tactile. It keeps every color the owner chose from the reference image
(`C:/Dev/Tempo-Design/9d607248922bb2053a1b000d3e7809c3.jpg`): the warm off-white page, cream, sand, taupe, sage and
dusty rose. It replaces the rest: puffy soft shadows on every control, one typeface, no pictures, white text under
AA. The approved mockups are the reference for every screen:
`docs/design/mockups/premium-2026-10-17/` and the canvas https://claude.ai/artifact/NUG1JaZVkZfPixXyeBTnNK.

### 2.1 The eight principles

Each principle comes from research on the leading apps of 2025 and 2026 (sources on the canvas's research board).
A screen review checks all eight.

| # | Principle | Source | Rule in Tempo |
|---|---|---|---|
| P1 | Content first, controls float above it | Apple Liquid Glass (iOS 26, refined in iOS 27: darker edges, brighter highlight) | Navigation bars, bottom sheets and chips over photos are **glass**; they float with a margin, never span edge to edge on a phone. The member tab bar shrinks while scrolling down. |
| P2 | One important thing at the top | Oura Today (Oct 2025), WHOOP Home (2025) | Every home screen leads with one hero: the member's next class, the owner's class running now plus one sentence about the day. |
| P3 | Choosing a place is an experience | Mariana Tek pick-a-spot | Rooms with spots are drawn as a room (window, mirror, instructor), not as a list. |
| P4 | Touch and physical feel | Airbnb redesign (May 2025), our Neo-Tactile root | Tactile objects (spots, wells, the slide-to-book knob) keep raised and sunken depth; everything else is flat paper. |
| P5 | One big action per screen | Google Material 3 Expressive research (46 studies, 18 000+ people) | One deep-sage primary per view, 52px on a phone, 44px on a computer. Other actions are paper or ghost. |
| P6 | Structure felt, not seen | Linear UI refresh (March 2026) | The console's side menu is quiet (muted text, no boxes); hairlines and spacing instead of borders and frames. |
| P7 | A real studio, not icons | Mariana Tek instructor profiles | Class covers, instructor faces and the studio's photo wherever a class or a person appears; initials only when there is no picture. |
| P8 | A typeface with character | Tempo decision | Frank Ruhl Libre (light) for moments: greetings, class names, big numbers. IBM Plex Sans Hebrew for everything else. |

### 2.2 Materials

| Material | Use | Recipe (tokens in v1.0) |
|---|---|---|
| Paper | Cards, rows, menus, dialogs | `--paper` ground, 1px hairline, a long soft lift shadow, top rim highlight |
| Glass | Floating bars, sheets, chips and panels over content or photos | 70% paper with `backdrop-filter: blur(24px) saturate(1.8)`, bright top highlight, 0.5px dark edge |
| Dark glass | Chips and buttons on photos | 34% warm ink with blur, white text |
| Well | Inputs, segmented controls, the week strip, the slide track, the room floor | cream with the inner shadow (the reference's "soft inner") |
| Photo | Heroes, class covers, faces | Always under a warm scrim where text sits on it; text on photos is white and at least 14px/600 |

### 2.3 Color (what changed in v1.0)

The grounds and accents are the reference's. Added so text passes AA: **deep sage** `#56735b` (the primary button
fill; white on it is 5.2:1, was 2.4:1 on `#98ae98`), **sage ink** `#46604b`, **rose ink** `#8a5f53`, **warm ink**
`#2b2420` for text (replaces navy), `--paper` `#fbfaf8`. The light sage `#98ae98` stays for fills, rings, progress,
dots and selection glow. Blue stays only for focus. No hex in app code.

### 2.4 Type

Frank Ruhl Libre 300/400/500 (`--font-display`) and IBM Plex Sans Hebrew 400/500/600/700 (`--font-sans`), both from
Google Fonts with full Hebrew. Display sizes: 44 to 72 (hero), 28 to 36 (screen titles), numbers in display at 34 to
58. Hebrew is never letter-spaced. Times, counts and money use tabular numerals.

### 2.5 Motion

Springs for things that move under a finger (spots, the slide knob, the tab bar): `cubic-bezier(0.3, 1.35, 0.5, 1)`.
One orchestrated moment per flow (the booking confirmation draws its check and lifts the ticket). Live things pulse
(the "now" dot). `prefers-reduced-motion` turns all of it off.

Earlier directions (flat/tactile hybrid, teal Soft UI, Neo-Tactile v0.3 one-to-one) are superseded by D16; the
options page records them. The June 2026 design in `C:/Dev/StudioPro/design` is superseded.

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

## 7. Component inventory

Button (sage default, cream secondary, ghost, rose CTA, danger, icon tile, loading, three sizes) · Field with Input, Select, Textarea, search
input · Toggle · Checkbox and Radio · Segmented control · Chip (status, category, count) · Card (flat, raised,
sunken, selected) · Stat tile and Progress ring · Progress bar · Avatar · Table · Tabs · Sidebar rail and expanded nav · Bottom tab bar · Banner ·
Toast · Dialog and bottom sheet · Skeleton · Empty state · Week schedule with event tiles · Class card · KPI tile ·
Weekly bar chart (one series, with a table for screen readers) · Compact link rows (owner reports, #256).

Two composed reference screens live in `packages/design-system/docs/specimen.html`: the console's weekly schedule and
the member app home.

Added by v1.0 (E7, docs/33): glass bar and glass sheet, dark glass chip, paper row with cover, hero card with photo
and scrim, live dot, countdown ring, room map with spot states (free, taken, mine, buddy, maintenance, selected,
attended, waiting, empty), slide to confirm, ticket with QR, wallet-style pass card, pace dots, heatmap cells,
insight card, activity row, command palette.

Not yet: data grid virtualization. Charts beyond the weekly bar chart follow the `dataviz` guidance
with these tokens.

## 8. Workflow

1. Change `tokens.json` → `pnpm --filter @tempo/design-system build` → commit both files.
2. New primitive → `components.css` + a block in `docs/specimen.html` + a preview in the reference artifact.
3. A React wrapper per primitive lands in each app, typed props, no styles. `apps/client-web` has them (date and
   time pickers, dropdown menu, dialog and toasts included); `apps/admin-web` gets its own when its screens start.

## 9. Every screen: phone, tablet, computer (D15)

**Decision (owner, 2026-10-17, #317):** every console (owner, coach, member) works from a phone, a tablet held either
way and a computer, with every function on each. The layout changes with the width; what a person can do does not.

| Width                                            | Studio console (`admin-web`)                                                                             | Member app (`client-web`)                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Under 1024px (phones, upright tablets)           | `tp-appbar` on top, the menu in a `tp-drawer`, the most used sections on a `tp-tabbar--fixed` with "עוד" | The page, then the bottom `tp-tabbar--fixed`; from 768px the page is 680px wide    |
| 1024px and up (tablets held sideways, computers) | The menu as a column at the start (`tp-nav`), the page beside it                                         | `tp-app`: the tabs as a `tp-sidenav` at the start, the page beside it, up to 880px |

- **Touch:** on a coarse pointer every control grows to `--touch-min` (44px); a mouse keeps the compact sizes. A text
  link that stands alone (a name, "לכל המערכת") gets `tp-hit`; plain links in a table get it on their own. Hover
  effects apply only where the pointer can hover (`@media (hover: hover)`), so a tapped button never stays lifted.
- **Tables:** a list that people read row by row is a `tp-table--stack`. When its frame is under 600px it becomes a
  list of cards: the first cell is the title, the other cells are lines named by their `data-label`, a `tp-table__end`
  cell sits at the card's top end, `tp-table__actions` is the card's last line, and `data-empty` leaves a cell out.
- **The week:** seven columns need 900px; narrower, the timetable is a week strip over one day's list (`tp-agenda`).
- **Dialogs** are bottom sheets under 768px and centered panels above it (already in `tp-dialog`).
- **Nothing scrolls sideways** at any width, and every new or changed screen is checked at 360px and at 1280px.
  `pnpm e2e --project=screens` opens every route of both apps at six sizes (`tests/e2e/support/screens.ts`) and fails
  on sideways scroll or a control under 44px on a touch screen.

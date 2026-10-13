Tempo is a scheduling and studio-management platform built in Israel, Hebrew-first, sold white-label to studios, coaches and clinics. Its interface is the "Neo-Tactile Soft UI" reference board reproduced one to one: a warm off-white page, cream and sand slabs with a gentle lift, taupe base cards and wells pressed softly into the surface, **sage** as the one action color with a mint glow on hover, **dusty rose** for the slider and the single elevated card on a screen, and **blue only for focus and selection**. Radii are small and precise, shadows are soft, highlights are diffused. Nothing shouts; depth and warmth do the work.

Use this page as the rules; the code is `packages/design-system` in the Tempo repository (`tokens/tokens.json` is the same file as this system's tokens, `css/components.css` is this system's bundle). Build screens from the primitives here; add a primitive to the package first, then here, never only in an app.

## Content fundamentals

- **Hebrew first, right to left.** Every screen is `dir="rtl" lang="he"`. Write all CSS with logical properties; never `left`/`right` in app code. English and Latin tokens inside Hebrew (TP, SMS, a product name, an email) sit in `<bdi>` or `.tp-ltr`. IDs, phone numbers, emails, URLs and code are `dir="ltr"`.
- **Numbers.** Ranges in words: "בין 8 ל-12", "08:30 עד 09:20". Never a dash, an arrow or × between numbers; they flip in RTL. Tabular numerals everywhere (`body` sets them). Currency after the amount: "240 ₪".
- **Voice.** Plain, short, second person, present tense. Buttons are verbs ("רישום לשיעור", "שמירה", "ביטול השיעור"), never "אישור" alone. Confirmations are past tense ("השיעור נשמר"). Errors say what happened and what to do next, without apology.
- **Gender.** Mixed forms with a dot where the subject is unknown ("מדריך.ה", "נרשם.ת"); the organization's configured form when known.
- **No emoji in UI copy.** Line icons carry meaning, words carry the message.
- **Dates and times.** `13.10.2026`, `08:30`, day names in full ("ראשון"). The week starts on Sunday.

## Color

Every value below was sampled from the reference image. Every text token names the grounds it reads on; the derived text tokens hold 4.5:1 there. Three pairs are kept exactly as the reference draws them although they are under AA, and are flagged in their notes: white on sage (`on-brand` on `brand`, 2.4:1), white on rose (`on-rose` on `rose`, 2.6:1), white on taupe (`on-taupe` on `taupe`, 2.8:1). Keep those labels at 15px or larger and 600 weight; never put running text on those fills. The light-blue focus ring is also reference-exact (1.7:1) and relies on its 14px glow to be seen.

**Grounds.** `canvas` is the page (#f5f4f2). `surface` is the cream slab (dropdowns, dialogs, toasts, the table, the rail). `surface-sand` is the sand slab (cards, stat tiles, event tiles, the class card). `surface-sunken` is a well (inputs, selects, tracks). `surface-hover` is a hovered row. `surface-deep` is the deep tile (empty state, pressed wells). `highlight` and `shade` are the two edges every shadow is made of; never fills.

**Ink.** `ink` for titles and body. `ink-muted` for secondary text, labels, table headers, meta lines. `ink-faint` for placeholders, disabled text and tick marks only. `ink-inverse` is the warm white used on taupe, rose and sage fills.

**Sage, the action color.** `brand` fills the default button, the toggle's on-track, the step indicator's done dot, today's date, the count badge and the logo tile; `brand-light` tops its subtle vertical gradient; `brand-hover` plus `brand-glow` (the mint halo) is hover; `brand-pressed` with `shadow-sunken` is pressed. `brand-soft` is the done-step fill and sage chips; `brand-ink` is sage text (the active rail item, links, the selected segmented option); `brand-deep` is the done-step line. One sage button per view.

**Rose, the accent.** `rose` and `rose-deep` make the elevated card's gradient and the slider's fill and progress fills; the rose button (`tp-btn--rose`) is the elevated card's call to action only. `rose-soft` for rose chips and the slider knob's rim, `rose-ink` for rose text. One elevated card per screen.

**Taupe, the ground of groups.** `taupe` to `taupe-deep` make the base card (sunken, white text) and the toast's icon tile; `taupe-soft` is the dropdown's hovered item and taupe chips; `taupe-ink` is taupe text and the avatar's initials. `sand` and `sand-deep` are the icon tiles inside base cards, avatars and image placeholders. `icon-dark` is the dark check tile and icons on sand. `disabled` is the disabled button's fill.

**Blue, only for focus and selection.** `focus` with `focus-glow` is the focus ring on everything interactive. `selected`, `selected-line` and `selected-ink` are the selected table row, list item or card: light blue ground, a 1.5px blue edge, blue text and check. Blue appears nowhere else.

**Status.** `success` is sage; `warning` is warm amber; `danger` is rose-red; `info` is the focus blue. Each has a `-soft` ground (chips, banners) and an `-ink` text. Status is always a word plus a color, never color alone; success and danger differ in lightness as well as hue.

**Categories.** Six class-type colors drawn from the same board: `cat-sage`, `cat-rose`, `cat-taupe`, `cat-blue`, `cat-amber`, `cat-mauve`, each with `-soft` and `-ink`. The vertical maps its class types onto them (studio default: yoga, pilates, strength, dance, HIIT, kids). The same type keeps the same category everywhere. Event tiles use the color as the start-edge bar and the fill bar, the ink for the count.

**White label.** A tenant may replace `brand`, `brand-light`, `brand-hover`, `brand-glow`, `brand-pressed`, `brand-soft`, `brand-ink`, `brand-deep` and the logo; the rest is platform-owned. Rose, taupe and the grounds never change per tenant.

## Typography

One family for the interface, one for data. **Heebo** (Google Fonts, 400 to 800, full Hebrew) is `sans`, the closest Hebrew-complete grotesk to the reference's face; **IBM Plex Mono** is `mono`, for IDs, API paths and code, always `dir="ltr"`.

Set text with the type styles, not ad-hoc sizes: `display-lg` (44/52, one per screen), `display-sm` (32/40, stat values), `h1` (28/36, page title), `h2` (20/28, card and section titles), `h3` (16/24, event and dialog titles), `body-lg` (16/24, reading text), `body` (15/22, the default), `body-sm` (13/20, meta and helper text), `label` (13/18 semibold, form labels, table headers, chips, tabs), `caption` (12/16, timestamps, in `ink-muted`), `code` (13/20 mono).

Display is 800, headings 700, labels 600, everything else 400 or 500. Display and h1 carry slight negative tracking. The eyebrow (12px, 600, tracked, `ink-muted`) sits above a page title. No italics in Hebrew UI. Lines of reading text stay under about 65 characters.

## Spacing, radius, size, borders

The reference scales: spacing 4 / 8 / 16 / 24 (extended with 12, 20, 32, 40, 48, 64); radius 4 / 8 / 12 (extended with 16, 20, 28, pill); borders 1 / 1.5 / 2; icons 16 / 20 / 24.

Buttons pad 20px inline at 42px height (`control-md`); `control-sm` is 34px (inside tables), `control-lg` 50px (member app, dialog footers). Inputs pad 16px. Cards pad `space-5` (20px) on phones and `space-6` (24px) on desktop; stat tiles pad `space-4`; cards sit `space-5` apart; sections `space-8` apart; the page gutter is `space-4` on phones and `space-8` on desktop, content stops at `content-max` (1200px).

Radii say what a thing is: `radius-xs` (4px) ticks and tiny badges; `radius-sm` (8px) icon tiles, chips, menu items, row highlights; `radius-md` (12px) buttons, inputs, selects, event tiles, toasts, banners; `radius-lg` (16px) stat tiles, small cards, the dropdown panel; `radius-xl` (20px) cards, the schedule, the rail, the empty tile; `radius-2xl` (28px) bottom sheets and the phone frame; `radius-pill` toggles, slider knobs, avatars, step dots, count badges.

Borders: `border-thin` (1px `line`) on table rows, menu separators and the cream secondary button; `border-mid` (1.5px `selected-line`) on a selected row; `border-thick` (2px) is the elevated card's white rim and the current step's sage ring. Nothing else has a border.

Every tappable thing has a `touch-min` 44px hit area. The sidebar is a rail of 52px icon tiles, `sidebar` 88px wide; it expands to 264px with labels on wide screens or on hover.

## Shadows: the reference's four levels

Light comes from above. Every shadow pairs a warm `shade` at low alpha below with a diffused `highlight` on top.

- **No shadow** (`shadow-flat`): disabled buttons, chips inside tables.
- **Soft inner** (`shadow-sunken`): inputs, selects, the toggle track, the base card, the empty tile, pressed buttons, the active rail item.
- **Gentle lift** (`shadow-raise`; `shadow-raise-sm` for small things): cards, stat tiles, the dropdown, the table, the toast, the rail; chips, event tiles, avatars, knobs, icon tiles.
- **Elevated float** (`shadow-float`): the elevated card, dialogs, the dropdown while open.

Plus two states: `shadow-brand` is the sage button at rest; `shadow-glow` is its hover (the mint halo); `shadow-focus` is the blue focus glow. Hover lifts a control 1px; press turns its shadow inner. A raised object inside a raised object is fine; a well inside a well is not.

## Motion

`duration-fast` (120ms) for hover and pressed; `duration-base` (180ms) for the toggle, the segmented knob and chips; `duration-slow` (280ms) for dialogs, sheets and toasts entering. `easing-standard` for anything entering or moving, `easing-exit` for anything leaving. `prefers-reduced-motion` collapses all of it; the skeleton shimmer and the loading spinner are the only loops.

## Layout

Consoles: the rail on the start side, a greeting header (eyebrow date, h1, a search well, cream icon tiles, the one sage button), a row of stat tiles that mixes the three card kinds (sand, taupe base, cream, and one rose elevated for the thing that needs attention), then the schedule beside a class card and its registrants. Content stops at `content-max`; grids wrap to one column below `bp-md`. The week schedule shows seven days from `bp-lg`, three on tablets, one on phones. The member app is a single column: greeting, the rose elevated card for the next class, a sunken week strip with a raised today, event tiles, two stat tiles, and the cream bottom tab bar with the sage action tile in its center.

Z-order: `z-dropdown` (menus) < `z-sticky` (headers) < `z-overlay` (scrim) < `z-modal` (dialogs, sheets) < `z-toast`.

## States every screen defines

Loading (Skeleton in the real layout after 300ms), empty (the deep sunken Empty tile naming the thing and its first action), error (Banner with the fix), partial failure (Banner above the data that did load), denied (Empty tile that says who to ask), offline (a persistent warning Banner). Selected rows, items and cards are blue (`selected`); hovered rows use `surface-hover`; pressed controls go sunken; focused anything shows the blue glow.

## Iconography

Line icons, 20px (16px inline, 24px in the rail and tiles), 1.8px stroke, round caps and joins, `currentColor`; the `tp-icon` class sets all of it. Draw from Lucide (ISC). Icons sit in tiles where the reference puts them: a sand tile inside base cards, a dark tile for checks and confirmations, a taupe tile in toasts. A meaningful icon has a text label or `aria-label`; a decorative one is `aria-hidden`.

## Logo

No logo file exists yet: set the name in `sans` 800 as plain type ("Tempo") with the sage rail tile holding a "T" as the placeholder mark, as the rail and the Cover do. Replace both when the mark arrives, without changing any other token.

Tempo is a scheduling and studio-management platform built in Israel, Hebrew-first, sold white-label to studios, coaches and clinics. The interface has one rule that everything else follows: **one material, two directions.** Every object is cut from the same light material as the page; what you touch or read is raised off it, what you type into is sunken into it, and nothing has a border. Radii are large, spacing is generous, the type is heavy at the top and quiet below. A teal gradient marks the one or two things that matter on a screen; navy is the ink; the week grid of rounded tiles is the signature shape.

Use this page as the rules; the code is `packages/design-system` in the Tempo repository (`tokens/tokens.json` is the same file as this system's tokens, `css/components.css` is this system's bundle). Build screens from the primitives here; add a primitive to the package first, then here, never only in an app.

## Content fundamentals

- **Hebrew first, right to left.** Every screen is `dir="rtl" lang="he"`. Write all CSS with logical properties; never `left`/`right` in app code. English and Latin tokens inside Hebrew (TP, SMS, a product name, an email) sit in `<bdi>` or `.tp-ltr`. IDs, phone numbers, emails, URLs and code are `dir="ltr"`.
- **Numbers.** Ranges in words: "בין 8 ל-12", "08:30 עד 09:20". Never a dash, an arrow or × between numbers, they flip in RTL. Tabular numerals everywhere (`body` sets them). Currency after the amount: "240 ₪".
- **Voice.** Plain, short, second person, present tense. Buttons are verbs ("רישום לשיעור", "שמירה", "ביטול השיעור"), never "אישור" alone. Confirmations are past tense ("השיעור נשמר"). Errors say what happened and what to do next ("אין חיבור לשרת, נסה שוב בעוד רגע"), without apology.
- **Gender.** Mixed forms with a dot where the subject is unknown ("מדריך.ה", "נרשם.ת"); the organization's configured form when known.
- **No emoji in UI copy.** Icons carry meaning, words carry the message.
- **Dates and times.** `13.10.2026`, `08:30`, day names in full ("ראשון"). The week starts on Sunday.

## Color

Two themes, always both. Every token below has a light and a dark value; every text token names the grounds it reads on and holds 4.5:1 there (3:1 for marks). Nothing in an app uses a hex value; it uses a token.

**Grounds.** `canvas` is the page and the material. `surface` is a raised object (cards, the rail, dialogs, buttons, chips, event tiles), one shade lighter than the canvas. `surface-sunken` is a well (inputs, tracks, banners, the active rail item). `surface-hover` is the hover of table rows. `surface-overlay` is the scrim. `highlight` and `shade` are the two edges every shadow is made of; they are never used as fills.

**Ink.** `ink` for text and icons. `ink-muted` for secondary text, table headers, captions. `ink-faint` only for placeholders, disabled text and decorative icons; it is not readable as body text and is never used for one. `ink-inverse` on ink-filled surfaces (toast, tooltip).

**Brand.** The brand is a gradient, `brand-light` to `brand` at 135deg, on the primary button, the toggle's on-state, today's date pill, the occupancy ring, the count badge, the member app's hero card and the logo tile; text on it is `on-brand`. Use it on one or two things per screen. `brand-ink` is teal text: the active rail item, the selected segmented option, the selected tab, links. `brand-soft` tints selected table rows only. `brand-deep` is decorative depth, never text. `brand-hover` and `brand-pressed` are the primary button's states.

**Status.** Four sets, each a fill (`success`, `warning`, `danger`, `info`) for icons and dots, a soft ground (`…-soft`) for chips and banners, and an ink (`…-ink`) for text on that ground. Status is always a word plus a color, never color alone; success and danger differ in lightness as well as hue. `danger` fills the destructive button, with `on-danger` text.

**Categories.** Six class-type colors, `cat-teal` … `cat-green`, each with `-soft` and `-ink`. The vertical maps its class types onto them (studio default: yoga, pilates, dance, barre, HIIT, kids). The same type keeps the same category everywhere in the app. Event blocks use the soft ground, the ink text and the fill color as the start edge and the occupancy bar.

**Lines and focus.** `line` only as the embossed hairline between table rows and list items (1px `line` over 1px `highlight`, the `.tp-divider` class). `line-strong` only for marks that must be told apart by an edge (chart axes). No borders on cards, inputs, buttons or chips. `focus` is the one focus ring: 2px solid, 3px offset, on every interactive element, in both themes.

**White label.** A tenant may replace `brand`, `brand-hover`, `brand-pressed`, `brand-soft`, `brand-ink` and the logo. The resolver verifies `on-brand` on the new `brand` at 4.5:1 and darkens the tenant color until it passes. Every other token is platform-owned.

## Typography

One family for the interface, one for data. **Heebo** (Google Fonts, weights 400 to 700, full Hebrew) is `sans`; **IBM Plex Mono** is `mono`, for IDs, API paths and code, always `dir="ltr"`.

Set text with the type styles, not ad-hoc sizes: `display-lg` (44/52, one per screen: the member app greeting, a hero number), `display-sm` (32/40, stat values), `h1` (28/36, page title), `h2` (20/28, card and section titles), `h3` (16/24, event and dialog titles), `body-lg` (16/24, reading text and dialog bodies), `body` (15/22, the default: tables, forms, lists), `body-sm` (13/20, event meta, helper text), `label` (13/18 medium, form labels, table headers, chips, tabs), `caption` (12/16, timestamps and footnotes, in `ink-muted`), `code` (13/20 mono).

Display is 800, headings are 700, labels are 600, everything else 400 or 500. Display and h1 carry negative tracking. The eyebrow (12px, 600, tracked 0.06em, `ink-muted`) sits above a page title to say where you are. No italics in Hebrew UI. Lines of reading text stay under about 65 characters.

## Spacing, radius, size

A 4px grid, generous. Buttons pad 22px inline; inputs 18px; cards pad `space-6` (24px) on phones and `space-8` (32px) on desktop; cards sit `space-5` apart; sections sit `space-8` apart; the page gutter is `space-4` on phones and `space-8` on desktop, content stops at `content-max` (1200px).

Radii say what a thing is: `radius-sm` (10px) for event tiles and menu items; `radius-md` (14px) for inputs; `radius-lg` (20px) for buttons, banners, toasts and the segmented track; `radius-xl` (28px) for cards, stat tiles, class cards, the rail and the schedule; `radius-2xl` (36px) for dialogs and bottom sheets; `radius-pill` for chips, toggles, avatars, icon buttons and the today marker.

Control heights: `control-sm` 36px (inside tables), `control-md` 44px (default), `control-lg` 52px (member app, dialog footers). Every tappable thing has a `touch-min` 44px hit area. The sidebar is a rail of round icon buttons, `sidebar` 88px wide; it expands to 264px with labels on wide screens or on hover.

## Shadows: one material, two directions

Light comes from the top-start corner. Every shadow is a pair: `shade` toward the bottom-end, `highlight` toward the top-start, plus a 1px inset highlight on the top edge of raised slabs.

**Raised** (`shadow-raise` on cards, the rail, the schedule, class cards, dialogs; `shadow-raise-sm` on buttons, chips, event tiles, avatars, the segmented knob, the toggle knob, the ring's discs): the object stands off the page. **Sunken** (`shadow-sunken` on inputs, the segmented and toggle tracks, progress tracks, banners, the active rail item, the cancelled event): the object is pressed into it. **Brand** (`shadow-brand`): the primary button's teal-tinted raise. **Float** (`shadow-float`): added to raise on things that leave the surface (dialogs, toasts, menus).

Pressing a raised control turns its shadow sunken (`:active`); hovering lifts it 1px. A raised object inside another raised object is fine (a chip in a card); a sunken well inside a sunken well is not. Never add a border to anything that has a shadow.

## Motion

`duration-fast` (120ms) for hover and pressed; `duration-base` (180ms) for toggles, chips and the segmented option moving; `duration-slow` (280ms) for dialogs, sheets and toasts entering. `easing-standard` for anything entering or moving, `easing-exit` for anything leaving. `prefers-reduced-motion` collapses all of it; the skeleton shimmer is the only looping animation.

## Layout

Consoles: the rail on the start side, a greeting header (eyebrow date, h1 "בוקר טוב, דנה", search well, round icon buttons, the one primary button), a row of stat tiles, then the schedule beside a class card and its registrants. Content stops at `content-max`; grids wrap to one column below `bp-md`. The week schedule shows seven days from `bp-lg`, three on tablets, one on phones. The member app is a single column: greeting, the brand hero card for the next class, a sunken week strip with a raised today, event tiles, two stat tiles, and the raised bottom tab bar with the gradient action button in its center.

Z-order: `z-dropdown` (menus) < `z-sticky` (headers) < `z-overlay` (scrim) < `z-modal` (dialogs, sheets) < `z-toast`.

## States every screen defines

Loading (Skeleton in the real layout after 300ms), empty (Empty state naming the thing and its first action), error (Banner with the fix), partial failure (Banner above the data that did load), denied (Empty state that says who to ask), offline (a persistent warning Banner). Selected rows use `brand-soft`; a selected card or class card gets a 2px inset `brand` ring; hovered rows use `surface-hover`; pressed controls go sunken; focused anything shows the `focus` ring.

## Iconography

Line icons, 20px (18px inside buttons), 1.8px stroke, round caps and joins, `currentColor`; the `tp-icon` class sets all of it. Draw from Lucide (ISC) and keep the set under one sprite per app; no filled icons, no two-tone, no emoji. A meaningful icon has a text label or `aria-label`; a decorative one is `aria-hidden`.

## Logo

No logo file exists yet: set the name in `sans` 800 as plain type ("Tempo") with the gradient rail tile holding a "T" as the placeholder mark, as the rail and the Cover do. Replace both when the mark arrives, without changing any other token.

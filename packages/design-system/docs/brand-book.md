Tempo is a scheduling and studio-management platform built in Israel, Hebrew-first, sold white-label to studios, coaches and clinics. The interface has one rule that everything else follows: **flat where you read, soft where you touch.** Surfaces, tables and lists are flat and crisp so a day with forty classes stays legible; the few things a hand actually presses (the primary button, toggles, the segmented switch, a class card, the occupancy ring) are softly raised off the canvas. Teal is the brand, navy is the ink, and the week grid is the signature shape.

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

**Grounds.** `canvas` is the page. `surface` is anything flat you read (cards, tables, panels, dialogs). `surface-sunken` is a well (inputs, tracks). `surface-hover` is the hover of rows and ghost buttons. `surface-overlay` is the scrim.

**Ink.** `ink` for text and icons. `ink-muted` for secondary text, table headers, captions. `ink-faint` only for placeholders, disabled text and decorative icons; it is not readable as body text and is never used for one. `ink-inverse` on ink-filled surfaces (toast, tooltip).

**Brand.** `brand` fills the primary button, the active nav item, today's date pill, the toggle's on-state and the ring; text on it is `on-brand`. `brand-soft` tints selected rows, the active segmented option and today's column; text on it is `brand-ink`, which is also the link color. `brand-deep` is the logo and decorative depth, never text. `brand-hover` and `brand-pressed` are the primary button's states only.

**Status.** Four sets, each a fill (`success`, `warning`, `danger`, `info`) for icons and dots, a soft ground (`…-soft`) for chips and banners, and an ink (`…-ink`) for text on that ground. Status is always a word plus a color, never color alone; success and danger differ in lightness as well as hue. `danger` fills the destructive button, with `on-danger` text.

**Categories.** Six class-type colors, `cat-teal` … `cat-green`, each with `-soft` and `-ink`. The vertical maps its class types onto them (studio default: yoga, pilates, dance, barre, HIIT, kids). The same type keeps the same category everywhere in the app. Event blocks use the soft ground, the ink text and the fill color as the start edge and the occupancy bar.

**Lines and focus.** `line` for hairlines (card borders, row dividers). `line-strong` for borders that carry meaning (checkbox outline, hovered input, chart axes; 3:1). `focus` is the one focus ring: 2px solid, 2px offset, on every interactive element, in both themes.

**White label.** A tenant may replace `brand`, `brand-hover`, `brand-pressed`, `brand-soft`, `brand-ink` and the logo. The resolver verifies `on-brand` on the new `brand` at 4.5:1 and darkens the tenant color until it passes. Every other token is platform-owned.

## Typography

One family for the interface, one for data. **Heebo** (Google Fonts, weights 400 to 700, full Hebrew) is `sans`; **IBM Plex Mono** is `mono`, for IDs, API paths and code, always `dir="ltr"`.

Set text with the type styles, not ad-hoc sizes: `display-lg` (36/44, one per screen: the member app greeting, a hero number), `display-sm` (28/36, stat values), `h1` (22/30, page title), `h2` (18/26, card and section titles), `h3` (16/24, event and dialog titles), `body-lg` (16/24, reading text and dialog bodies), `body` (15/22, the default: tables, forms, lists), `body-sm` (13/20, event meta, helper text), `label` (13/18 medium, form labels, table headers, chips, tabs), `caption` (12/16, timestamps and footnotes, in `ink-muted`), `code` (13/20 mono).

Headings are 600, display is 700, labels are 500, everything else 400. No italics in Hebrew UI. Lines of reading text stay under about 65 characters.

## Spacing, radius, size

A 4px grid. Controls pad with `space-3` (12px) inline; cards pad `space-4` on phones and `space-5` on desktop; cards sit `space-4` apart; sections sit `space-6` apart; the page gutter is `space-4` on phones and `space-8` on desktop, content stops at `content-max` (1200px).

Radii say what a thing is: `radius-md` (8px) for inputs, event blocks and flat buttons; `radius-lg` (12px) for cards, tables and dialogs on phones; `radius-xl` (16px) for the tactile controls, raised cards and desktop dialogs; `radius-2xl` (24px) for bottom sheets; `radius-pill` for chips, toggles, avatars and the today marker.

Control heights: `control-sm` 32px (inside tables), `control-md` 40px (default), `control-lg` 48px (member app, dialog footers). Every tappable thing has a `touch-min` 44px hit area even when it draws smaller. The sidebar is `sidebar` 248px wide.

## Shadows: the two families

**Flat** (`shadow-flat`, `shadow-float`): `shadow-flat` on cards and tables at rest, barely visible; `shadow-float` on anything that floats (menus, dialogs, toasts).

**Tactile** (`shadow-raise`, `shadow-raise-sm`, `shadow-sunken`, `shadow-brand`): a light edge on the top-start side and a dark edge on the bottom-end side, so the element reads as pushed out of the canvas or pressed into it. `shadow-brand` is the primary button only. `shadow-raise` is the class card and large tiles. `shadow-raise-sm` is the secondary button, the active segmented option and the toggle knob. `shadow-sunken` is every input well, track and ring track.

Tactile elements sit on `canvas` or `surface-sunken`. On a white `surface` the light edge vanishes and the element looks dirty: put an outline button there instead. Never mix a tactile shadow with a hairline border on the same element.

## Motion

`duration-fast` (120ms) for hover and pressed; `duration-base` (180ms) for toggles, chips and the segmented option moving; `duration-slow` (280ms) for dialogs, sheets and toasts entering. `easing-standard` for anything entering or moving, `easing-exit` for anything leaving. `prefers-reduced-motion` collapses all of it; the skeleton shimmer is the only looping animation.

## Layout

Consoles: a 248px sidebar on the start side, a sticky page header, content in one column up to `content-max`, cards in a grid that wraps to one column below `bp-md`. The week schedule shows seven days from `bp-lg`, three on tablets, one on phones. The member app is a single column with a bottom tab bar and `control-lg` actions.

Z-order: `z-dropdown` (menus) < `z-sticky` (headers) < `z-overlay` (scrim) < `z-modal` (dialogs, sheets) < `z-toast`.

## States every screen defines

Loading (Skeleton in the real layout after 300ms), empty (Empty state naming the thing and its first action), error (Banner with the fix), partial failure (Banner above the data that did load), denied (Empty state that says who to ask), offline (a persistent warning Banner). Selected rows and cards use `brand-soft`; hovered rows use `surface-hover`; focused anything shows the `focus` ring.

## Iconography

Line icons, 20px (18px inside buttons), 1.8px stroke, round caps and joins, `currentColor`; the `tp-icon` class sets all of it. Draw from Lucide (ISC) and keep the set under one sprite per app; no filled icons, no two-tone, no emoji. A meaningful icon has a text label or `aria-label`; a decorative one is `aria-hidden`.

## Logo

No logo file exists yet: set the name in `sans` 700 as plain type ("Tempo") with the `brand` square as a placeholder mark, as the Cover does. Replace both when the mark arrives, without changing any other token.

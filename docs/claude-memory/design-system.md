# Design system

- **The look is "Warm Glass" (D16, 2026-10-17).** The owner approved the premium mockups
  (`docs/design/mockups/premium-2026-10-17/`, canvas https://claude.ai/artifact/NUG1JaZVkZfPixXyeBTnNK). It keeps the
  colours of the 2026-10-13 reference image "Neo-Tactile Soft UI" (never re-tint: no teal, no navy) and changes the
  rest: glass for floating bars and sheets, paper cards, wells only for tactile things, real photos, Frank Ruhl Libre
  for moments and IBM Plex Sans Hebrew for UI, one deep-sage `#56735b` action per screen (white on it 5.2:1). The
  eight principles and their sources: `docs/25_Design_System.md` section 2. A screen that shows a capability must be
  backed by it (`docs/33_Studio_Experience_LLD.md`). The v0.3 package below is what is on `main` until step E7.
- **Palette** (sampled from the image, v0.3):

  | Token               | Value                                                                   |
  | ------------------- | ----------------------------------------------------------------------- |
  | Page                | `#f5f4f2`                                                               |
  | Cream               | `#ece9e4`                                                               |
  | Sand                | `#e4dbd4`                                                               |
  | Taupe               | `#a49689`                                                               |
  | Sage button         | `#98ae98` (hover glow `#cfe1d4`, pressed `#869986`, disabled `#d6cfc7`) |
  | Rose accent         | `#bd998d`                                                               |
  | Focus and selection | `#8fc4ee` / `#cae1ef`                                                   |

  Radii are 4, 8 and 12 (plus 16, 20 and 28). White text on sage, rose or taupe is kept exact even though it is
  under AA; those pairs are flagged.

- **Light is the face of the product.** `tokens.css` ignores the OS theme. Dark only applies with an explicit
  `data-theme="dark"`.
- Hebrew, right to left, first.
- **Package:** `packages/design-system` (`@tempo/design-system`) holds:
  - `tokens.json`, built into `css/tokens.css`;
  - `base.css` and `components.css` (`tp-*` classes);
  - `docs/specimen.html` and `docs/brand-book.md`;
  - `scripts/check-tokens.mjs`, a WCAG contrast lint.
- The normative doc is `docs/25_Design_System.md`.
- **Rule:** UI code never uses a hex value. It uses the tokens and the `tp-*` classes.
- **React wrappers** live in each app's `src/shared/design-system/` (client-web since #51, #54, #55, #56): they
  render the `tp-*` classes and own aria, focus and keyboard. Added to the package on 2026-10-15: menu popover, toast
  region, `tp-calendar`, `tp-slot`, `tp-week`, filter chips, block segmented and tabs, fixed tab bar, `tp-setting`,
  `tp-btn--ghost-danger`, `tp-bar--sand`. **Missing:** charts, a logo file, and the reference artifact's previews of
  the new primitives (Kris to review the look).
- **Every screen (D15, 2026-10-17, #317):** phone, tablet and computer for every console. Under 1024px the studio
  console has `tp-appbar`, a `tp-drawer` menu and a bottom `tp-tabbar--fixed` (היום, מערכת, אנשים, דוחות, עוד); from
  1024px the side menu. The member app keeps its tab bar under 1024px and uses `tp-app` with a `tp-sidenav` above it.
  Tables that list rows are `tp-table--stack` (cards under 600px, `data-label` per cell). On touch screens controls
  are 44px and hover effects are off. Rules in `docs/25_Design_System.md` section 9; `pnpm e2e --project=screens`
  checks every route at six sizes. The apps pick the layout with `useMediaQuery` (`src/shared/useMediaQuery.ts`);
  jsdom has no `matchMedia`, so unit tests get the computer layout in admin-web and the phone layout in client-web
  unless they call `screenWidth()` from `src/test/screens.ts`.

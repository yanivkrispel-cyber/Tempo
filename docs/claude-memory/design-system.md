# Design system

- **The reference is one image**, "Neo-Tactile Soft UI", which the owner chose on 2026-10-13. The product must match
  it one-to-one in buttons and colours. Never re-tint it: no teal, no navy.
- **Palette** (sampled from the image, v0.3):

  | Token | Value |
  |---|---|
  | Page | `#f5f4f2` |
  | Cream | `#ece9e4` |
  | Sand | `#e4dbd4` |
  | Taupe | `#a49689` |
  | Sage button | `#98ae98` (hover glow `#cfe1d4`, pressed `#869986`, disabled `#d6cfc7`) |
  | Rose accent | `#bd998d` |
  | Focus and selection | `#8fc4ee` / `#cae1ef` |

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
- **Missing:** a date and time picker, a dropdown menu, charts, a logo file, and React wrappers once the apps are
  scaffolded.

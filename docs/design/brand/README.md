# Tempo brand: the logo and the mark

Kris's logo (2026-10-18, board #347): three leaves above the word TEMPO.

| File | What it is |
|---|---|
| `tempo-logo-original.png` | Kris's original, 855 x 583 px, off-white background. The source of truth for the look; too small to scale up (the mark is about 200 px tall). |
| `tempo-mark.svg` | The mark only, redrawn as vectors: two dark leaves `#262626` and the sage top leaf `#828a81`, both sampled from the PNG. Transparent background, `viewBox="0 0 200 200"`, the mark centred. |
| `tempo-mark-on-brand.svg` | The same mark for a sage-deep background: the dark leaves in white `#ffffff`, the top leaf in `--brand-glow` `#cfe1d4` (the PNG's sage nearly disappears on `#56735b`). |
| `preview.png` | The redraw next to the original (with the SVG's outline over the PNG) and the icon backgrounds below. |

## Where it is used

- **App icons and favicons** (P-1 on board #347): the **mark only**, never the word. "TEMPO" is unreadable at 48 px and
  a maskable circle cuts it.
  - Member app (`apps/client-web`): `tempo-mark.svg` on paper `#fbfaf8` (`--paper`).
  - Console (`apps/admin-web`): `tempo-mark-on-brand.svg` on sage-deep `#56735b` (`--brand`), so the two icons are told
    apart on one phone.
- The full logo with the word (the PNG) is for places with room: a sign-in page, a document, a slide. Not redrawn yet.

## Safe area for a maskable icon

A maskable icon may be cropped to any shape that contains the centred circle of 80% of its width (radius 40%). The
mark's furthest point is 105.3 units from the centre of its 200-unit box, so:

- **Maskable:** draw the 200-unit box at **at most 75%** of the icon's width, centred (0.75 x 105.3 / 200 = 0.395 of the
  width, inside the 0.40 radius). The background colour fills the whole square.
- **`any` icons, `apple-touch-icon` and favicons:** the box can take 72% to 80% of the width; iOS rounds the corners of
  the apple-touch-icon itself, so give it a solid background, not transparency.

## How the SVG was made

Each leaf is fitted with cubic Béziers to the PNG's edges (the right dark leaf mirrors the left one around the mark's
centre line), then the control points were tuned to the PNG's pixels: the drawn shapes overlap the original's at 99.4%
(intersection over union, dark leaves and sage leaf each). Edit the SVGs by hand if the logo changes; there is no
generator to keep in step.

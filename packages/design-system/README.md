# @tempo/design-system

The one source of visual truth for the three Tempo web apps (`admin-web`, `client-web`, `platform-admin-web`).
Tokens live in `tokens/tokens.json`; everything else is generated from or written against them.

Browsable reference (live previews, same tokens): https://claude.ai/artifact/4MSvEKktJR25A76416N5nC
Design direction and the options it was chosen from: `docs/25_Design_System.md` in the repo root.

## Layout

```text
packages/design-system/
├── tokens/tokens.json      THE tokens: color (light + dark), type, spacing, radius, shadow, size, duration, easing, z-index, breakpoints
├── css/tokens.css          generated: CSS custom properties + .text-* classes      (pnpm build)
├── css/base.css            reset, fonts, focus ring, RTL defaults, page scaffold
├── css/components.css      framework-agnostic primitives, class prefix tp-
├── docs/specimen.html      every component in Hebrew RTL, light and dark; open it in a browser
└── scripts/                build-tokens.mjs (json → css), check-tokens.mjs (shape + WCAG contrast; runs as lint/test)
```

## Use in an app

Load order, once, in the app entry (`main.tsx` or `index.html`):

```ts
import "@tempo/design-system/tokens.css";
import "@tempo/design-system/base.css";
import "@tempo/design-system/components.css";
```

Set the document direction and language: `<html dir="rtl" lang="he">` (Hebrew is the default locale; LTR works with
the same CSS because everything is written with logical properties). Theme: the app is light. Nothing set means light;
the OS theme is never followed. `data-theme="dark"` on `<html>` switches to dark only from an explicit user choice,
which the app persists.

React components in `src/shared/design-system/` of each app are thin wrappers that render these classes and own
behaviour (focus management, aria, keyboard). They never restyle a primitive; a visual change goes here, once.

## Rules that keep the system one system

1. **Every color comes from a token.** No hex in app code or in component wrappers. Need a new color: add a token
   with a usage note, run `pnpm lint` (contrast check), then use it.
2. **The reference image is the law.** `C:/Dev/Tempo-Design/9d607248922bb2053a1b000d3e7809c3.jpg` defines every
   color, shadow level and radius; the tokens were sampled from it. Sage is the only action color, rose the only
   accent, blue only for focus and selection. A new look for a control starts by finding it in the image.
3. **Status is never hue alone.** Every status chip carries a word; success and danger also differ in lightness.
   White-on-sage, white-on-rose and white-on-taupe are reference-exact and under AA: labels only, 15px+, 600.
4. **Numbers are tabular.** `body` sets `tabular-nums`; keep it in tables and stats. Hebrew text with Latin or
   numbers inside: wrap the Latin in `<bdi>` or `.tp-ltr`, write ranges in words ("בין 8 ל-12"), never with a dash.
5. **Touch targets are 44px** even when the control looks 32px (`--touch-min`).
6. **Focus is visible** everywhere: the reference's blue glow (`shadow-focus`, a 3px halo plus a 14px glow). Do not remove it.
7. **White label changes the sage set only** (`brand`, `brand-light`, `brand-hover`, `brand-glow`, `brand-pressed`,
   `brand-soft`, `brand-ink`, `brand-deep`) and the logo. Rose, taupe and the grounds never change per tenant.
8. **Motion is short** (120 to 280ms) and respects `prefers-reduced-motion`.

## Editing tokens

```sh
pnpm --filter @tempo/design-system build   # json → css/tokens.css
pnpm --filter @tempo/design-system lint    # names unique, usage notes present, every text/ground pair ≥ 4.5:1 (3:1 for marks)
```

Commit `tokens.json` and the regenerated `tokens.css` together. The design-system artifact is updated from this
file (same JSON shape), so the page and the code never drift.

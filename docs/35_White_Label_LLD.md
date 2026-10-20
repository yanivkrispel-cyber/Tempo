# White Label LLD (the studio's own name, logo, colour and icon)

> **Status:** Approved by Kris on 2026-10-19 (D21): W-1 to W-12 as written (W-1 as amended by WL2: the accent as a mark at 3:1), except W-10, which he changed to a
> branded sign-in per studio (D22, docs/36, ADR-0028). Built on board #380 (WL1 to WL6).
> **Audience:** Kris, Ofir, the agents.
> **Related:** docs/18 (the baseline: brand model, resolution order, what is allowed and forbidden), docs/33 and D16
> (Warm Glass), docs/15 and docs/33 section 6 (pictures on S3), ADR-0021 ($0 until revenue), ADR-0027 (the apps on
> Cloudflare Pages), D15 (every screen on a phone and a computer), board #347 K1 (Tempo's own logo and icons).

After the premium redesign, the next thing a studio asks is "can it look like us?". A member who books twice a week
should see their studio's name and logo, and, on their phone, an icon that says the studio, not "Tempo". This
document plans that in the smallest safe steps: a brand record per studio, where it shows, the studio's installable
icon, and what stays Tempo's.

## 1. Scope

In:

- a brand per studio: app name, logo, icon, one accent colour from an approved set (W-1 to W-3);
- where the brand shows in the member app, the console, the join and invite pages and the check-in pass (section 4);
- the studio's own installable app for its members: a manifest and icons per studio (W-4 to W-6);
- what one install means for a member of two studios (W-5);
- the guardrails of docs/18 section 5 made concrete: no free colours, no custom CSS or scripts, contrast checked.

Out (later, each needs its own decision): custom domains (W-8), branded email and sender (waits for docs/30 D-1 and
D-2), custom fonts (W-7), a store app per studio, and paid branding plans (W-11). The branded sign-in page (W-10) was
added by Kris on 2026-10-19 and is planned in docs/36.

## 2. The brand model

One row per studio, `organizations.brands` (a later migration; the number is taken when it is built):

| Field | Rule |
|---|---|
| `app_name` | What the phone shows under the icon. 1 to 12 characters (longer names are cut on home screens). Default: the studio's display name when it fits, else its first word. |
| `accent_id` | One of the approved accents (W-1). Default `sage` (today's look). |
| `logo_media_id` | A picture (`purpose = studio_logo`): the studio's logo for headers, transparent or on white, up to 8 MB like every upload. Optional. |
| `icon_media_id` | A picture (`purpose = studio_icon`): a square mark for the home screen, at least 512 x 512. Optional; without it the icon is the studio's initials on the accent (W-2). |
| `icon_background` | `paper` or `accent`. Default `paper`. |
| `version` | Bumped on every change; icon and manifest URLs carry it so phones see a change. |

- Who may change it: `organization.settings.manage` (owner, admin), the same rule as the studio cover. Audit
  `brand.updated` with field names only.
- Pictures go through the existing flow (presigned POST, finalize, re-encode, `media/<org>/<id>/...`). For an icon the
  finalize step also renders the PNG sizes a phone needs: 192 and 512 `any`, 512 `maskable` (mark inside the 80%
  circle), 180 for iOS, on the chosen background. SkiaSharp already does the re-encoding, so no new dependency.
- Removing a studio and exporting it cover the brand row and its pictures (docs/32 section 10 walks the catalog;
  the export lists the brand).

## 3. Colour: an approved set, never a free hex

| Id | Default | Rule |
|---|---|---|
| W-1 | **Eight accents, chosen by Tempo, each with its light and dark values and its ink:** sage (today's `--brand`), olive, ocean, plum, rose, terracotta, sand, graphite. A studio picks one by id; the API refuses anything else. | Each accent ships as a set of tokens (`--brand`, `--brand-hover`, `--brand-pressed`, `--brand-ink`, `--brand-soft`, `--brand-glow`, `--on-brand`). A design-system test checks every pair the components use: white text on the accent and the accent's ink on paper at least 4.5:1, and the accent itself as a mark at least 3:1 against paper (the focus ring is Tempo's blue for every accent, so the glow is decorative; WL2 review on #382). A failing accent never ships, so no studio can make a button unreadable. |

- The accent changes the brand tokens only. Warm Glass surfaces, ink, status colours (danger, warning, success) and
  category colours stay Tempo's, so a red "cancel" never turns into the studio's pink.
- The apps set `data-accent="<id>"` on `<html>` once the studio is known; the CSS for all eight is in the design
  system (a few hundred bytes each), so there is no runtime CSS from the server and nothing to inject.

## 4. Where the brand shows

| Place | What the member or staff member sees |
|---|---|
| Member app header and home | The studio's logo (else its name) and the accent. "Tempo" moves to a small "built with Tempo" line in the profile. |
| Member app installed icon and name | The studio's icon and `app_name` (section 5). |
| Join and invitation pages (`/join`, `/invite`) | The studio's logo and name above the invitation, so a new member knows whose link it is. |
| The check-in pass | The studio's logo on the card with the QR. |
| Web push notifications | The studio's icon as the notification's icon. |
| Console | Stays Tempo (W-9): the studio's logo small next to its name in the header. Staff use one tool for every studio they work at. |
| Sign-in page | The studio's own: `/s/<slug>/login` in its look, our screen over Cognito (W-10, docs/36). `/login` is Tempo's. |
| Emails | Later, with docs/30 D-1 and D-2. |

## 5. The studio's own installable app

Today one manifest serves every member (`client-web/public/manifest.webmanifest`, fixed by board #347 O1). A studio's
own icon needs a manifest per studio.

| Id | Default |
|---|---|
| W-4 | **A studio path in the member app: `https://<members app>/s/<slug>/`.** Its manifest has `id` and `scope` `/s/<slug>/`, `start_url` `/s/<slug>/`, the studio's `app_name`, icons and accent as `theme_color`. Chrome and Safari treat each path as its own app. The plain `/` stays the generic "Tempo" app. |
| W-5 | **A member of two studios may install two icons**, one per studio, each opening locked to its studio. The generic `/` app gets a studio switcher (today it shows the first active membership only, which is a gap for those members anyway). Sign-in is shared: one Tempo account, one session on the origin. |
| W-6 | **The API serves the manifest and the icons**, public and cacheable, no sign-in: `GET /api/v1/public/studios/{slug}/manifest.webmanifest` and `GET /api/v1/public/studios/{slug}/icons/{size}.png?v=<version>`. The member app adds `<link rel="manifest" crossorigin>` and `apple-touch-icon` for the studio path before the page offers "install". Icon responses carry `Cache-Control: public, max-age=31536000, immutable` (the version is in the URL). A suspended or removed studio answers 404 and the app falls back to the generic manifest. |

- Why the API and not a Cloudflare Pages Function: the brand lives in the database and S3 already, it keeps
  everything that reads customer data on AWS (ADR-0001), and Pages stays static files with no secrets (ADR-0027).
  The manifest is cross-origin, which Chrome allows with CORS. A manifest's `start_url`, `scope` and `id` resolve
  against the manifest's own URL, and Chrome drops a `start_url` or `scope` on another origin than the page, so the
  API writes them **absolute, on the members app's origin** (`CLIENT_APP_URL`, already in its config): for example
  `"start_url": "https://<members app>/s/<slug>/"`. A relative `/s/<slug>/` would point at the API host and the
  studio's app would not install; WL4's test checks the three are absolute and same-origin with the members app. The install gate of board #347 K2 (`pwa-check.mjs`) gets a mode that checks one
  studio's manifest the same way.
- The service worker (`/sw.js`, push only, P-4 of board #347) keeps scope `/`, so one push subscription serves every
  installed studio icon on that phone. A notification carries its studio, and a tap opens `/s/<slug>/...`.
- Invitation and join links for a branded studio point at `/s/<slug>/invite#...` and `/s/<slug>/join#...`, so the
  first screen a new member sees is already their studio's.
- iPhone: Add to Home Screen reads the page's `apple-touch-icon` and title at that moment, so the studio path sets
  both; the install sheet of board #347 O2 shows the studio's name in its steps.

## 6. Custom domains (later)

| Id | Default |
|---|---|
| W-8 | **Not before revenue.** A studio's own domain (`app.studio.co.il`) needs a TLS certificate per hostname and routing to the members app. With the apps on Cloudflare Pages that is Cloudflare for SaaS custom hostnames, which has a free allowance and a per-hostname price above it; with CloudFront it is a certificate and an alternate domain per distribution. When a paying studio asks, a new ADR prices it and picks the path (docs/18 section 6's request, DNS check, ownership check, TLS, routing, renewal). Never the coachkrispel domain. |

## 7. Costs (ADR-0021)

| Piece | Fixed | Variable |
|---|---|---|
| Brand row, pictures, icon sizes | $0 | Six small PNGs and two pictures per studio on the S3 bucket that exists since #331 (cents a year at pilot size) |
| Manifest and icon routes | $0 | Lambda and API Gateway requests, a few per install and per icon refresh; inside the free tier at pilot size |
| Accent tokens | $0 | A few kilobytes of CSS |
| Custom domains | Not built | Priced in its own ADR (W-8) |

Nothing here needs a new paid service.

## 8. Open questions and defaults

| Id | Question | Default |
|---|---|---|
| W-1 | Which colours may a studio choose? | Eight vetted accents (section 3), no free hex. |
| W-2 | A studio without an icon? | Its initials (up to two letters, Hebrew or Latin) on its accent, rendered by the API. |
| W-3 | App name length? | 1 to 12 characters; the console shows a home-screen preview while typing. |
| W-4 | One app or one per studio? | Both: `/` generic, `/s/<slug>/` per studio (section 5). |
| W-5 | A member of two studios? | Two icons if they want; the generic app gets a switcher. |
| W-6 | Who serves the manifest and icons? | The API, public and cacheable (section 5). |
| W-7 | Fonts? | No custom fonts: the Hebrew font of the design system stays for every studio (load time, Hebrew coverage). |
| W-8 | Custom domains? | Later, by ADR, after revenue (section 6). |
| W-9 | Does the console take the studio's brand? | No: it stays Tempo with the studio's logo small in the header. |
| W-10 | The sign-in page? | **Changed by Kris (2026-10-19):** branded per studio. Cognito's managed login has no Hebrew and no right-to-left, so it is a screen of our own in the members app over Cognito's API (docs/36, ADR-0028), design B. The console keeps the Hosted UI. |
| W-11 | Is branding part of a paid plan? | Every studio on the pilot plan gets it. When plans are priced (docs/28 B-1), Kris decides. |
| W-12 | Does Tempo's name stay anywhere for members? | A small "built with Tempo" line in the member app's profile and on the join page. |

## 9. Build steps (when Kris says go)

| Step | What | Lane |
|---|---|---|
| WL1 | The brand row, its permission and audit, the `studio_logo` and `studio_icon` purposes, icon sizes at finalize; contract and tests | K |
| WL2 | The eight accents as tokens with the contrast test; `data-accent` in both apps | O |
| WL3 | The console's brand settings page with the home-screen preview (360 and 1280 px) | O |
| WL4 | The public manifest and icon routes; `pwa-check.mjs` checks one studio | K |
| WL5 | The member app's `/s/<slug>/` path, the studio's manifest link, the switcher in `/`, branded join and invite links | O |
| WL6 | Live check on dev: brand a demo studio, install it on Android, `Page.getInstallabilityErrors` empty for `/s/<slug>/` | K and O |

Each step is a small PR with tests first, as on every board.

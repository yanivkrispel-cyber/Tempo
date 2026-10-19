# Studio Marketing LLD (stories, the public studio page, links that count)

> **Status:** Approved direction (Kris, 2026-10-19: "בוא נלך לפי ההמלצה"). Q1 to Q6 of the research page are
> answered with the recommendation (section 3). The new questions M-7 to M-14 carry defaults that apply unless Kris
> changes them. Nothing here is built yet.
> **Audience:** Kris, Ofir, the agents.
> **Related:** docs/29 (sessions, occupancy, waitlist cutoff, passes), docs/30 (inbox, push, kinds), docs/31 (the
> health gate), docs/33 (instructor profiles, pictures, insights and suggestions), docs/35 (brand, `/s/<slug>/`,
> public manifest routes), docs/36 (branded sign-in and sign-up, board #380), ADR-0021 ($0 until revenue), D15
> (every screen on a phone and a computer), D16 (Warm Glass).
> **Research and mockups:** the RTL page https://claude.ai/artifact/7TfmXmwG3SnvMi7SJ2rRRZ (private to Kris): a
> live story builder, nine templates, and the research with sources.

Studio owners advertise their classes on Instagram stories every week. Today they copy the timetable by hand into
Canva, write "מקומות אחרונים" themselves, and scribble a line over a class that was cancelled. Tempo already holds
every fact such a story shows: the week's sessions, how full each one is, what was cancelled, who teaches, the
studio's photos, logo and accent. This document plans three things in the smallest safe steps:

1. **A public studio page** a story's link can point at, where someone who is not yet a member sees the week and a
   class, signs up and books (stage A; nothing works without it).
2. **A story generator** in the console that draws a finished 1080x1920 story from live data, in the studio's
   brand, and hands it to Instagram or WhatsApp in one tap (stage A).
3. **Links that count:** every link Tempo hands out carries its source, so the owner sees which story brought
   bookings, not only likes (stage A), and later member share cards, referrals and events (stage B).

## 1. What the research found (2026-10-19)

| Finding | What it means for the design |
|---|---|
| Mindbody, bsport, Momence, Glofox and Arbox offer booking links, website widgets and email or SMS campaigns. None of their public docs shows a story drawn from the schedule. Studios use Canva kits (18 to 50 templates) by hand. | The generator is a differentiator, and its value is live data (occupancy, cancellations), not templates. |
| Instagram's Content Publishing API publishes stories (`media_type=STORIES`) for professional accounts, 100 API posts per 24 h, after Meta app review. The API adds **no stickers**: no link, countdown or poll. | Stage A shares the image through the phone's share sheet and copies the link; the owner adds the link sticker herself. Automatic publishing is stage C and only for stories without a link (M-3). |
| A story's link sticker needs a page that a non-member can open. Tempo has none: joining needs a join code (docs/26 section 5.2) and every read needs sign-in. | Stage A starts with the public page and an open join (sections 4 and 5). |
| Every Tempo fact a story shows already exists: `GET /sessions` with `bookedCount`, `capacity`, `waitlistCount`, status, instructor with photo, class cover (docs/29, docs/33), brand and slug (docs/35). | The generator needs no new domain data, only rendering, a share step and the source codes. |

Sources: Meta Instagram Platform "Content Publishing" docs; vendor docs and help centres of Mindbody (Marketing
Suite), bsport, Momence (plugins and widgets), Arbox (registration link); Canva and Creative Market template kits.
The links are on the research page.

## 2. Scope by stage, and when to build each

| Stage | What | When | Why then |
|---|---|---|---|
| **A** | Public studio and class pages with sign-up and booking; open join with a studio switch; an intro pass; source codes on links, memberships and bookings with a "where bookings came from" report; the story generator with four templates (week, last spots today, spot opened, schedule change); suggestions to the owner; the WhatsApp text. | **The next board after #380** (day plan 10, from 2026-10-20), as one night of two lanes. Must be on dev **before the first pilot studio goes live**. | It builds on tonight's work: the brand and `/s/<slug>/` (WL1, WL4, WL5) and the branded sign-up (docs/36). A pilot owner's first marketing question is "how do people sign up from Instagram". |
| **B** | The member's "I'm in" card, milestone cards (10, 50, 100 classes), "meet the instructor", events and workshops with their own page and a countdown, bring-a-friend links, the QR poster, highlight covers, a weekly reminder to post. | **Two to four weeks into the pilot**, ordered by what the source report shows the pilot studio uses. | Member cards need real members and real bookings; the report tells us which channel matters. |
| **C** | Animated stories (short video), automatic publishing through Meta (no link), a monthly "Wrapped" for members, AI-written Hebrew captions, a review turned into a card. | **After revenue** (ADR-0021). | Each one costs money or a Meta review: video rendering, AI tokens, a verified business with a privacy policy on our own domain. |

Stage A has no recurring cost: the image is drawn in the owner's browser, the pictures are already on S3 (D17), the
pages are on Cloudflare Pages (ADR-0027). The one prerequisite that is not code is **the domain** (already decided:
"buy before the pilot", 2026-10-13): a WhatsApp message and the poster show the link's address, and
`tempo-members.pages.dev/s/noga` does not look like a studio's. Stage A works on `pages.dev` for dev.

## 3. Decisions

Q1 to Q6 were asked on the research page; Kris chose the recommendation for each on 2026-10-19.

| Id | Question | Decision |
|---|---|---|
| M-1 (Q1) | Where does a story's link lead? | **A public page of the studio and of each class.** Anyone sees it, signs up with an email and a code (docs/36), joins the studio and books a first class. |
| M-2 (Q2) | A first class for someone who came from a story? | **The studio decides**: free, a special price, or the regular price. Default: no intro pass, the regular products (M-8 says how that works without payments). |
| M-3 (Q3) | Connect to Instagram? | **Not in stage A.** The phone's share sheet and a download on a computer; the link is copied for the sticker. Meta publishing is stage C. |
| M-4 (Q4) | Who may make a story? | **The owner and admins for the whole studio, and every instructor for their own classes only.** |
| M-5 (Q5) | The member's "I'm in" card? | **Yes, in stage B**: a share button after booking, with the studio's tag, never another member's name. |
| M-6 (Q6) | How much design freedom? | **Our fixed templates.** The owner changes the photo, the headline, a short note, which classes show and whether instructors show. The brand colour comes from the studio's accent (docs/35). Every story looks premium. |

New questions; the defaults apply unless Kris changes them:

| Id | Question | Default |
|---|---|---|
| M-7 | Is a studio's public page on by default? | **Off** until the owner turns it on in the console ("עמוד ציבורי"), with a preview first. A studio that never asked for a public page shows none. |
| M-8 | How does a newcomer pay when Tempo charges nothing yet (docs/28 B-1)? | **An intro product the studio marks `public_intro`** (a punch card or a one-class card with its price, docs/29 section 5.1). A newcomer who joins through the public page gets it granted once, **marked "to pay at the studio"**, and staff see it on the roster. No intro product: the page shows the studio's products and "נרשמים בסטודיו" for paying. When merchant payments arrive (Phase 6), this becomes a checkout. |
| M-9 | Open join: can anyone become a client from the public page, without a join code? | **Yes, when the public page is on** and the studio's switch "הצטרפות פתוחה" is on (default on together with M-7). The new membership is `active` (docs/26 O-2). The owner can turn it off, which leaves only the join link. A verified email is required (docs/36). |
| M-10 | How exact is the occupancy a stranger sees? | **A bucket, not a count:** `open`, `few` (3 or fewer places left, with the number), `full` (with the waitlist if it is open), `cancelled`. Never names, never the roster. |
| M-11 | The thresholds for the story labels? | "מקומות אחרונים" from 75% booked, "מלא · רשימת המתנה" at capacity, "בוטל" with a struck line for a cancelled session. Below 75% nothing, or "נשארו N מקומות" if the owner picks that. Per-studio thresholds are not configurable in stage A. |
| M-12 | Attribution model? | **First touch on the membership, last touch on the booking**, both from the link's source code, kept 30 days in the browser (section 6). No cookies from third parties, no tracking pixels, no fingerprinting. |
| M-13 | When does Tempo suggest a story to the owner? | Weekly (default Sunday 09:00, the owner can change or turn it off), when a place frees up after the waitlist closed, and when a session is cancelled or its instructor changes. At most three suggestions a day per studio. |
| M-14 | Instructor details on a public page or a story? | Display name, photo, headline and Instagram handle from the instructor's profile (docs/33 section 5), only when the instructor turned on "show my profile publicly" (new switch, default off). Otherwise the class shows without an instructor. |

## 4. The public studio page (stage A)

### 4.1 Routes in the members app (`client-web`)

| Route | Signed out | Signed in as a member of the studio |
|---|---|---|
| `/s/<slug>/` | The studio's public page: cover, logo, name, the week's classes with occupancy buckets, the intro offer, "הצטרפי". | The member home of that studio (docs/35 W-4, unchanged). |
| `/s/<slug>/c/<sessionId>` | One class: time, class type and cover, room, instructor (M-14), occupancy bucket, "להירשם לשיעור". | The class's booking sheet (as today). |
| `/s/<slug>/week/<yyyy-mm-dd>` | The week starting on that Sunday. | The timetable on that week. |

A page with the public switch off, an unknown slug, or a suspended or removed studio shows "הסטודיו לא נמצא" and
answers like the API (404). The pages are part of the installable studio app (docs/35 section 5): same manifest,
same scope.

### 4.2 Public read API

All under the route group that WL4 (board #380 K2) opens, `GET /api/v1/public/studios/{slug}/...`: no sign-in,
CORS for the members app, a 404 for a suspended, removed or non-public studio, cacheable.

| Call | Returns | Cache |
|---|---|---|
| `GET /public/studios/{slug}` | name, app name, logo and cover URLs, accent id, address line, the intro product (name, price) if any, `openJoin` | `public, max-age=300` |
| `GET /public/studios/{slug}/sessions?from=&to=` | up to 14 days: id, start, duration, class type name and category, room name, cover URL, instructor (M-14) or null, `availability` (M-10), `spotsLeft` only when `few` | `public, max-age=60` |
| `GET /public/studios/{slug}/sessions/{id}` | one session as above | `public, max-age=60` |

- Picture URLs are presigned GETs (docs/33 section 6), valid one hour; the cache time stays below that.
- **Rate limit:** per source IP at the edge (API Gateway route throttling on the public group) and in the API
  (fixed window per IP and slug). Exact numbers in the build PR.
- **No person data.** The handlers read through a dedicated read model that cannot select bookings, people or
  rosters; a test asserts the JSON keys.
- The tenant comes from the slug, resolved once to the organization id; every query after that runs under RLS as
  today (docs/04).

### 4.3 Sign up, join, book

1. The visitor taps "להירשם לשיעור" on `/s/<slug>/c/<id>`.
2. Not signed in: the branded sign-up of docs/36 at `/s/<slug>/login?returnTo=/s/<slug>/c/<id>`. **`returnTo` must
   be a same-origin path under `/s/<slug>/`**; anything else is dropped (open-redirect threat, docs/36 L-7).
3. Signed in but not a member: `POST /api/v1/public/studios/{slug}/join` (signed in, verified email, no code)
   creates the `active` client membership when `openJoin` is on (M-9), records the first-touch source (section 6),
   and grants the intro pass once per person and studio (M-8). Rate-limited per account like `/join`
   (docs/26 section 10.3). Idempotent.
4. The health declaration (docs/31) appears if the studio requires it (H-5), then the normal booking of docs/29
   section 6.2, with the last-touch source on the booking.
5. The member lands on the class's ticket in the studio's app, with the install offer (docs/35).

### 4.4 Console

Settings, "עמוד ציבורי": the public switch (M-7), open join (M-9), which product is the intro offer (M-8), a preview
of the page at 360 and 1280 px, the link with a copy button and the QR (stage B: the poster). The instructor's own
profile gets the "show my profile publicly" switch (M-14).

## 5. Database (stage A; numbers taken at build time, after board #380's 0032 and 0033)

```sql
-- Public page settings: one row per studio, created on first save.
CREATE TABLE organizations.public_pages (
    organization_id  uuid PRIMARY KEY REFERENCES organizations.organizations (id),
    enabled          boolean NOT NULL DEFAULT false,      -- M-7
    open_join        boolean NOT NULL DEFAULT true,       -- M-9, only read when enabled
    intro_product_id uuid NULL,                           -- M-8, a scheduling.pass_products row of this studio
    suggest_weekly_at text NULL,                          -- M-13, 'sun 09:00' local time, NULL = off
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       uuid NOT NULL
);

-- Links Tempo hands out, each with a short code.
CREATE TABLE marketing.links (
    organization_id uuid NOT NULL,
    id              uuid NOT NULL DEFAULT gen_random_uuid(),
    code            text NOT NULL CHECK (code ~ '^[a-z0-9]{6,10}$'),
    channel         text NOT NULL CHECK (channel IN ('story', 'whatsapp', 'bio', 'poster', 'member_card', 'referral', 'other')),
    template        text NULL,       -- 'week', 'today', 'spot_opened', 'change', later others
    session_id      uuid NULL,       -- when the link points at one class
    created_by      uuid NOT NULL,   -- membership id
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, code)
);
```

- `organizations.memberships` gets `source_link_id uuid NULL` (first touch); `scheduling.bookings` gets
  `source_link_id uuid NULL` (last touch). Both are set once, never edited.
- `scheduling.pass_products` gets `public_intro boolean NOT NULL DEFAULT false`; `scheduling.passes` gets
  `to_pay_at_studio boolean NOT NULL DEFAULT false` (M-8).
- `organizations.staff_profiles` (docs/33 section 5.1) gets `public_profile boolean NOT NULL DEFAULT false` (M-14).
  Its existing `visible` flag (shown to members) stays; `public_profile` is the separate consent for strangers.
- RLS on every new table as on every tenant table; removal and export (docs/26, docs/27) cover them.
- Permissions: `marketing.publish` (owner, admin: every class) and `marketing.publish.own` (instructor: their own
  sessions only), both in the catalog of docs/27. The public page settings use `organization.settings.manage`.
- Audit: `public_page.updated` (field names only), `marketing.link.created` (channel, template, no text).

## 6. Links and the source report (stage A)

- A link is `https://<members app>/s/<slug>/c/<sessionId>?src=<code>` or `/s/<slug>/?src=<code>`. The code is
  not personal and not secret; it appears in Cloudflare's and our logs, which is fine.
- The members app reads `src`, keeps `{code, at}` in `localStorage` for 30 days (M-12), and sends it in the body of
  `POST /public/studios/{slug}/join` (first touch) and of the booking call (last touch). The API resolves the code
  inside the studio; an unknown code is ignored, never an error.
- The console creates a link whenever it shares one (`POST /organizations/{id}/marketing/links` with channel,
  template and session), so every story and every WhatsApp text has its own code.
- **Report** "מאיפה הגיעו ההרשמות" in the console's reports (docs/32 style: live query under RLS, no table, no job):
  for the last 7 or 30 days, per channel and per link, new members and bookings, and how many of those bookings
  were attended. `reports.view`.

## 7. The story generator (stage A)

### 7.1 Where and who

Console, new section "פרסום" (phone and computer, D15). The owner and admins see every class; an instructor sees only
their own sessions (M-4). Entry points: the section itself, a suggestion card (7.4), and "פרסמי" on a class's
detail screen.

### 7.2 Templates in stage A

| Template | Data | Trigger |
|---|---|---|
| `week`: the week in the studio | the chosen week's sessions (the owner can hide any), labels by M-11, an optional handwritten note (40 characters), photo from the studio's pictures | weekly suggestion, or by hand |
| `today`: last places today | today's sessions with 60% to 100% booked, dots for places (spots map when it exists, docs/33 section 3) | morning, or by hand |
| `spot_opened`: a place freed up | one session, after its waitlist closed (docs/29 `waitlist_cutoff_hours`), instructor photo if public | the place frees up (7.4) |
| `change`: the timetable changed | cancelled sessions and instructor changes of the next 7 days | the change happens (7.4) |

Each template is a fixed design in the studio's accent (docs/35 W-1), Warm Glass type (Frank Ruhl Libre, IBM Plex
Sans Hebrew, plus a condensed face for times), right to left, with a free area at the bottom for Instagram's link
sticker. The research page shows all four and five more for stage B.

### 7.3 Rendering and sharing ($0)

- **Drawn in the browser with Canvas 2D at 1080x1920**, one small drawing module per template in `admin-web`, with
  shared helpers for RTL text (`ctx.direction = 'rtl'`), fitting a line to a width, and pictures with `cover` crop.
  Fonts are loaded with the `FontFace` API before drawing. No server, no headless browser, no library that clones
  the DOM into an SVG (fonts and cross-origin pictures break there).
- **Pictures:** the presigned S3 GETs must allow CORS from the console's origin, or the canvas is tainted and cannot
  be exported. The picture bucket's CORS rule allows only `POST` from the apps' origins today (uploads,
  `infrastructure/lib/api/api-stack.ts`); it gets `GET` from the same origins (an infrastructure change for K). An
  `<img>` needs no CORS, so nothing else changes.
- **Share:** on a phone, `navigator.canShare({ files })` then `navigator.share({ files: [png] })` opens the share
  sheet, and Instagram's "Story" target takes the picture. On a computer, or where sharing files is not supported,
  the PNG downloads. In both cases the link is copied to the clipboard first, with a toast "הלינק הועתק, הדביקי
  אותו במדבקת הלינק". To check on real devices in the build: Android Chrome, iPhone Safari, and the installed console
  app on both.
- **WhatsApp text:** the same data as plain Hebrew text with the link, and a copy button. No WhatsApp provider and no
  cost (docs/30 keeps SMS and WhatsApp sending for later).

### 7.4 Suggestions

The owner gets a suggestion card in the console and an inbox item with push (docs/30), new kind
`marketing.suggestion` in the staff group, on by default, switchable per person:

- weekly at `suggest_weekly_at` (M-13): "הסטורי של השבוע מוכן";
- a place freed up after the waitlist closed, at least 90 minutes before the class: "התפנה מקום ב-20:00, לפרסם?";
- a session cancelled or its instructor changed: "המערכת השתנתה, לעדכן את העוקבות?".

At most three a day per studio (dedupe in the request key, docs/30). The cards join `GET /insights/suggestions` of
docs/33 section 9.

## 8. Stage B and C, planned in outline

Each gets its own short section in this document before it is built.

- **"I'm in" card (M-5):** in the member app after a booking, a share button draws a card (class, time, spot,
  instructor, the studio's tag) with a `member_card` link. Nothing about other members.
- **Milestones:** at the 10th, 50th and 100th attended class, an inbox item and a card to share, from the history of
  docs/33 section 9 (C3). Off for a member who turned it off.
- **Meet the instructor:** a template from the public profile (M-14) and the instructor's next classes.
- **Events and workshops:** a one-off session (docs/29) with a price shown, its own public page and a template with
  room for a countdown sticker; reminders a week and a day before.
- **Bring a friend:** a personal `referral` link per member; the friend gets the intro offer; the referrer gets an
  entry by the owner's rule. Needs M-8 first.
- **QR poster:** an A4 PNG (2480x3508) in the studio's brand with a `poster` link.
- **Highlight covers:** round icons in the studio's accent for Instagram highlights (timetable, prices, how to get
  here, instructors).
- **Stage C:** animated stories (video rendered in the browser with WebCodecs where possible, else a paid renderer),
  automatic publishing through Meta for stories without a link (needs the domain, a privacy policy and Meta's
  review), a monthly "Wrapped" for members, AI captions in the studio's tone (cost approval), a high review turned
  into a card with the member's consent.

## 9. Privacy and security

- Public reads show only what the owner chose to make public: the studio, its sessions, buckets of occupancy, and
  instructors who turned their profile public. No names, no rosters, no counts of a member's visits.
- A member's card and milestone are shared only by the member's own tap. No automatic posting about a person.
- Open join needs a verified email (docs/36), is rate-limited, and the owner can turn it off at once (M-9).
- `returnTo` is a same-origin path under the studio's prefix, checked in the app; the API never redirects.
- Source codes are not personal data; the attribution sits on the studio's own rows and leaves with the studio's
  export.
- The canvas draws only pictures the studio uploaded; the export is a PNG on the owner's device. Nothing is sent to
  Meta or anyone else by Tempo in stages A and B.
- Threats checked in the build PR's review: data leak through the public API (key test), slug enumeration (public by
  design; a non-public studio answers 404 like an unknown one), open redirect, sign-up spam through open join (rate
  limits, verified email, owner switch), a tainted canvas (CORS), and an instructor shown without consent (M-14).

## 10. Costs (ADR-0021)

| Item | Cost |
|---|---|
| Public pages and API | $0: Cloudflare Pages and the existing API Lambda; reads are small and cached. |
| Story rendering | $0: in the owner's browser. |
| Pictures | The existing S3 bucket (D17, about US$0.10 a month); a CORS rule is free. |
| Suggestions | The existing hourly job and push (docs/30). |
| The domain | Already planned before the pilot (about US$10 to US$15 a year). |
| Stage C | Video rendering, AI tokens and Meta's business verification each need Kris's approval with a price. |

## 11. Build steps for stage A (the next board after #380)

| Step | What | Lane | After |
|---|---|---|---|
| MK1 | Migration: `public_pages`, `marketing.links`, the source columns, `public_intro`, `to_pay_at_studio`, the instructor `public_profile` flag; permissions `marketing.publish` and `marketing.publish.own`; contract | K | board #380 merged (0032, 0033 taken) |
| MK2 | Public read API (4.2) on WL4's route group: the read model, buckets, caching, rate limits, the key test | K | MK1, WL4 |
| MK3 | Open join with intro pass and first-touch source (4.3 step 3); the booking call takes the last-touch source | K | MK1 |
| MK4 | Links API and the source report (section 6) | K | MK1 |
| MK5 | S3 CORS `GET` for the two app origins; suggestions kind and triggers (7.4) | K | MK1 |
| MO1 | Public pages in `client-web`: `/s/<slug>/` signed out, `/c/<id>`, `/week/<date>`; `src` capture; sign-up with `returnTo` into join, health declaration and booking (4.3) | O | MK2, MK3, docs/36's screens |
| MO2 | Console "עמוד ציבורי" settings with preview (4.4), and the instructor's public switch | O | MK1 |
| MO3 | Console "פרסום": the four templates on Canvas, share and download, the copied link, the WhatsApp text | O | MK4, MK5 (CORS) |
| MO4 | Suggestion cards in the console; the source report screen | O | MK4, MK5 |
| MK6 | Live check on dev: a test studio public, a story drawn and its link opened signed out, sign-up, join, book, and the report counts it; `premium-live-check.mjs` extended | K with O | all |

Every screen at 360 and 1280 px (D15), Hebrew right to left, fictional people only (the repo is public, D14).

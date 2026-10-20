# Studio Marketing LLD (stories, the public studio page, links that count)

> **Status:** Approved (Kris, 2026-10-19: "בוא נלך לפי ההמלצה"). Q1 to Q6 of the research page are answered with
> the recommendation (section 3); M-7 to M-17 carry defaults that apply unless Kris changes them. **Stages A and B are
> built on board #380 tonight** (Kris, 2026-10-19 evening), after its white label tasks; stage C waits for a paying
> studio, and everything stays $0 until then (ADR-0021).
> **Audience:** Kris, Ofir, the agents.
> **Related:** docs/29 (sessions, occupancy, waitlist cutoff, passes), docs/30 (inbox, push, kinds), docs/31 (the
> health gate), docs/33 (instructor profiles, pictures, insights and suggestions), docs/35 (brand, `/s/<slug>/`,
> public manifest routes), docs/36 (branded sign-in and sign-up, board #380), ADR-0021 ($0 until revenue), D15
> (every screen on a phone and a computer), D16 (Warm Glass).
> **Research and mockups:** the RTL page https://claude.ai/artifact/7TfmXmwG3SnvMi7SJ2rRRZ (private to Kris): a
> live story builder, nine templates, and the research with sources. A copy that opens offline:
> `docs/design/mockups/marketing-2026-10-19/studio-stories.html` (the studio, people and numbers are fictional).

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
| **A** | Public studio and class pages with sign-up and booking; open join with a studio switch; an intro pass; source codes on links, memberships and bookings with a "where bookings came from" report; the story generator with four templates (week, last spots today, spot opened, schedule change); suggestions to the owner; the WhatsApp text. | **Board #380, the night of 2026-10-19**, after the white label tasks it builds on (Kris moved it from the next board). Must be on dev **before the first pilot studio goes live**. | It builds on the same night's brand and `/s/<slug>/` (WL1, WL4, WL5) and the branded sign-up (docs/36). A pilot owner's first marketing question is "how do people sign up from Instagram". |
| **B** | The member's "I'm in" card, milestone cards, "meet the instructor", events and workshops with their own page and a countdown, bring-a-friend links with a reward, the QR poster, highlight covers. | **Board #380 too, right after stage A** (Kris, 2026-10-19 evening). What doesn't finish by morning carries to the next board. | All $0 and built on stage A's links; ready before the pilot so the first studio's members can share from day one. |
| **C** | Animated stories (short video), automatic publishing through Meta (no link), a monthly "Wrapped" for members, AI-written Hebrew captions, a review turned into a card. | **After the first paying studio** (Kris, 2026-10-19; ADR-0021). | Each one costs money or a Meta review: video rendering, AI tokens, a verified business with a privacy policy on our own domain. |

Stages A and B have no recurring cost: the image is drawn in the owner's browser, the pictures are already on S3 (D17), the
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
| M-15 | The studio's own Instagram handle on member cards? | A field in "עמוד ציבורי" settings, empty by default; empty means no tag on the card. |
| M-16 | Milestone thresholds? | 10, 25, 50, 100 and 200 attended classes in one studio. Not configurable in stage B. |
| M-17 | Bring-a-friend reward? | Off until the owner picks a reward product. Then one pass of it per friend whose first booking is attended, at most 10 a month per member. |

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

## 8. Stage B (built on board #380 after stage A)

Every item is $0: drawn in the browser, data already in Tempo, existing notification channels. The one new library is
`qrcode` (npm, MIT, runs in the browser) for the poster.

### 8.1 "I'm in": the member's card (M-5)

- In the member app, after a booking succeeds and on the class's ticket, a button "שתפי" draws a 1080x1920 card on
  Canvas: the class cover, class name, day and time, the spot number if there is one, the instructor if their
  profile is public (M-14), the studio's name and accent, and the studio's Instagram handle when set (M-15). Never
  another member's name or picture.
- The link copied with it is `/s/<slug>/c/<sessionId>?src=<code>`, where the code is the member's own
  `member_card` link (8.5).
- Share and download exactly as the console does (section 7.3).

### 8.2 Milestones

- When attendance marks a booking `attended` (docs/29 section 6.4) and the person's attended count in that studio
  reaches **10, 25, 50, 100 or 200** (M-16), the API writes a notification request of the new kind
  `member.milestone` (dedupe key `member.milestone:{count}:{person_id}`), inbox and push, in a new member group
  `celebrations` that the member can switch off (default on).
- The inbox item opens `/s/<slug>/milestone/<count>`: a card drawn on Canvas with the count, hours on the mat (sum of
  attended durations), the longest run of weeks in a row, the usual class time and the most frequent instructor.
  `GET /api/v1/organizations/{id}/me/milestones` computes these live under RLS (docs/33 X-10: no table, no job).
- Sharing is the member's own tap only. Nothing about a milestone is visible to other members.

### 8.3 Meet the instructor

A console template `instructor`: the instructor's photo, name, headline, a quote (the first sentence of the bio,
editable in the story), the Instagram handle, and their classes in the next 7 days. Only for an instructor whose
`public_profile` is on (M-14). The instructor can make their own (`marketing.publish.own`).

### 8.4 Events and workshops

- An event is a **one-off session** (docs/29) with event fields: `event_title` (up to 60 characters),
  `event_description` (up to 600), `event_price_agorot` (shown only, like `price_agorot`), and `pass_required`
  (default true).
- `pass_required = false`: booking holds no pass entry; the booking is marked `to_pay_at_studio` (M-8), staff see it
  on the roster. Capacity, waitlist, cancellation and the health gate work as for any session.
- The console's one-off session form gets a switch "אירוע / סדנה" with the fields and a cover picture.
- The public class page (4.1) shows an event in its own layout: title, description, date range in words, price,
  places left.
- A console template `event` with a free area for Instagram's countdown sticker, and a new reminder kind
  `reminder.event_week` (7 days before) next to the existing `reminder.class_tomorrow` (docs/30).

### 8.5 The member's own links, and bring a friend

- `POST /api/v1/organizations/{id}/me/share-link` with `channel` `member_card` or `referral` returns the caller's own
  link for that channel (one per member and channel, created on first use, then reused). Any active client
  membership may call it; `marketing.links.created_by` is the member's membership.
- **Bring a friend:** the member app's profile gets "הביאי חברה" with the referral link, a copy button and the
  phone's share sheet (text only).
- A friend who joins through the public page with a `referral` code is the referrer's referral (first touch, section
  6). **Reward (M-17):** the studio picks a product in "עמוד ציבורי" settings (`referral_reward_product_id`, default
  none = no reward). When the friend's **first booking is marked attended**, the referrer gets one pass of that
  product, once per friend, at most 10 a month per referrer, audited `referral.rewarded` (ids only), and an inbox
  item `member.referral_rewarded` ("חברה שהזמנת הגיעה לשיעור הראשון"; never the friend's name).
- No reward when the friend was already a member or a recorded person of the studio before joining, or joined by a
  join code or an invitation.

### 8.6 The QR poster

Console "פרסום", "פוסטר": an A4 portrait PNG (2480x3508) on Canvas, in the studio's brand: logo, name, a headline
("סרקי והירשמי לשיעור"), the intro offer line if any, and a QR code of `/s/<slug>/?src=<poster code>` drawn by
`qrcode` in the browser. Download only.

### 8.7 Highlight covers

Console "פרסום", "כיסויי היילייטס": six 1080x1920 PNGs, one icon each in a circle on the studio's accent:
timetable, prices, about, instructors, how to get here, reviews. Icons from the design system's set. Downloaded one by
one (no zip library).

### 8.8 Database for stage B (one migration, numbered at build time)

```sql
ALTER TABLE scheduling.sessions
    ADD COLUMN event_title        text NULL CHECK (length(event_title) BETWEEN 1 AND 60),
    ADD COLUMN event_description  text NULL CHECK (length(event_description) <= 600),
    ADD COLUMN event_price_agorot int  NULL CHECK (event_price_agorot >= 0),
    ADD COLUMN pass_required      boolean NOT NULL DEFAULT true;
ALTER TABLE scheduling.bookings ADD COLUMN to_pay_at_studio boolean NOT NULL DEFAULT false;
ALTER TABLE organizations.public_pages
    ADD COLUMN instagram_handle           text NULL CHECK (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
    ADD COLUMN referral_reward_product_id uuid NULL;
-- marketing.referral_rewards (organization_id, referrer_membership_id, friend_membership_id, pass_id, rewarded_at),
-- unique (organization_id, friend_membership_id): one reward per friend.
```

New notification kinds `member.milestone`, `member.referral_rewarded` (group `celebrations`) and
`reminder.event_week` (group `reminders`), each with a Hebrew default template (docs/30 `TemplateCatalog`).

### 8.9 Stage C (after a paying studio, ADR-0021)

Animated stories (video), automatic publishing through Meta for stories without a link (needs the domain, a privacy
policy and Meta's review), a monthly "Wrapped" for members, AI captions in the studio's tone, a high review turned
into a card with the member's consent. Each one needs Kris's approval with a price; none is built before a studio
pays.

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
- Board #404 hardened the public surface (S-A to S-D, D24): gateway throttling of the public routes below the API's
  reserved concurrency, per-address and per-account counters on joins and share links, the same 404 for an unknown
  and a suspended studio, and `private, no-store` on everything that isn't public. The table is in section 12.9;
  the new public routes (products, one product, a link by code, the brand, the preview covers) are in section 12.

## 10. Costs (ADR-0021)

| Item | Cost |
|---|---|
| Public pages and API | $0: Cloudflare Pages and the existing API Lambda; reads are small and cached. |
| Story rendering | $0: in the owner's browser. |
| Pictures | The existing S3 bucket (D17, about US$0.10 a month); a CORS rule is free. |
| Suggestions | The existing hourly job and push (docs/30). |
| The domain | Already planned before the pilot (about US$10 to US$15 a year). |
| Stage C | Video rendering, AI tokens and Meta's business verification each need Kris's approval with a price. |

## 11. Build steps (board #380, night of 2026-10-19, after the white label tasks)

Stage A first, then stage B. A step waits for the steps in "After". Migrations are K's; each takes the next free number
when it is written (0032 and 0033 are #380's K1 and K5). What doesn't finish by 06:30 carries to the next board in
the same order.

| Step | Stage | What | Lane | After |
|---|---|---|---|---|
| MK1 | A | Migration: `public_pages`, `marketing.links`, the source columns, `public_intro`, `to_pay_at_studio` on passes, the instructor `public_profile` flag; permissions `marketing.publish` and `marketing.publish.own`; contract (post SYNC) | K | #380 K1, K5 |
| MK2 | A | Public read API (4.2) on WL4's route group: the read model, buckets, caching, rate limits, the key test | K | MK1, #380 K2 |
| MK3 | A | Open join with intro pass and first-touch source (4.3 step 3); the booking call takes the last-touch source | K | MK1 |
| MK4 | A | Links API and the source report (section 6) | K | MK1 |
| MK5 | A | S3 CORS `GET` for the two app origins; the `marketing.suggestion` kind and its triggers (7.4) | K | MK1 |
| MO1 | A | Public pages in `client-web`: `/s/<slug>/` signed out, `/c/<id>`, `/week/<date>`; `src` capture; sign-up with `returnTo` into join, health declaration and booking (4.3) | O | MK2, MK3, #380 O3, O5 |
| MO2 | A | Console "עמוד ציבורי" settings with preview (4.4), and the instructor's public switch | O | MK1 |
| MO3 | A | Console "פרסום": the four templates on Canvas, share and download, the copied link, the WhatsApp text | O | MK4, MK5 |
| MO4 | A | Suggestion cards in the console; the source report screen | O | MK4, MK5 |
| MK6 | A | Live check on dev: a test studio public, a story drawn and its link opened signed out, sign-up, join, book, and the report counts it; `premium-live-check.mjs` extended | K with O | stage A merged |
| MK7 | B | Migration for stage B (8.8); the three notification kinds with templates; contract (post SYNC) | K | MK1 |
| MK8 | B | `me/share-link`; milestones on attendance and `me/milestones`; referral reward on the friend's first attendance; event booking without a pass; `reminder.event_week` | K | MK7, MK3 |
| MO5 | B | Member app: "I'm in" card and share, the milestone card, "הביאי חברה" in the profile | O | MK8 |
| MO6 | B | Console: the event switch on the one-off session form; the event layout on the public page; the `event` template | O | MK7, MO1 |
| MO7 | B | Console: the `instructor` template, the QR poster (`qrcode`), the highlight covers | O | MO3 |
| MK9 | B | Live check on dev for stage B: a milestone at 10 on a test member, a referral reward, an event booked without a pass | K with O | stage B merged |

Every screen at 360 and 1280 px (D15), Hebrew right to left, fictional people only (the repo is public, D14).
**$0 (ADR-0021):** no paid service and no new AWS resource; the only infrastructure change is a CORS rule on the
existing bucket. No Meta connection, no WhatsApp or SMS provider, no AI, no video rendering (all stage C).

## 12. Share links by intent (board #404, 2026-10-20)

Kris approved SL-1 to SL-10 on board #404 (from #380's night; D25). A story's link leads where the post points, not
always to the studio's page. Why: in Kris's example (a real Arbox studio, 2026-10-19) Instagram could link only the
whole price list, with the trial offer as row four, and a single class had no address of its own. The design is the
canvas https://claude.ai/artifact/49ZHvC1fjRQWBEEKWLJQ9b (private to Kris); its boards are saved as HTML in
`docs/design/mockups/share-links-2026-10-19/` (#409).

### 12.1 Targets and routes

| Target | Members app route | Used by |
|---|---|---|
| `session` (one class; an event and a member's invite are sessions too) | `/s/<slug>/c/<sessionId>` | `today`, `spot_opened`, `instructor`, `event` stories; a member's card |
| `schedule` (the week) | `/s/<slug>/` | `week` and `change` stories, the QR poster, the Instagram bio link, a referral |
| `offer` (one listed product) | `/s/<slug>/o/<productId>` | the `offer` story |
| `prices` | `/s/<slug>/prices` | a bio or WhatsApp link to the price list |

Every link keeps `?src=<code>`. `marketing.links` holds `target_kind` and `target_id` (migration 0036, #413): an id
exactly for `session` and `offer`; a session target keeps `session_id = target_id`, so the studio's foreign key still
holds it, and an offer's product reaches the studio's `pass_products` through a stored column and a composite
foreign key. The console's share sheet asks "לאן הקישור יוביל?" with the template's default (SL-6). The source
report adds the target to each link and counts per target (`byTarget`).

### 12.2 Listed products, the offer page and the prices page

The owner lists products on the public page (`listedProducts`, #424): the order is the public order, an offer is
`newcomersOnly` with an optional last day (`publicUntil`) and a line of up to 120 characters. Stage A's intro product
became a listed offer for newcomers in 0036, and `intro_product_id` stays readable for one release.
`GET /public/studios/{slug}/products` lists offers first, then the owner's order, with the price per class for punch
cards ("10 שיעורים, 70 ₪ לשיעור"); `GET …/products/{id}` answers `{ ended, product }` so an ended offer shows the
prices with one line saying so (SL-4, SL-5). Prices are shown only: "נרשמים כאן, משלמים בסטודיו" until merchant
payments (Phase 6).

### 12.3 The offer join (SK3, #425)

`POST /public/studios/{slug}/join` with `productId` and `sessionId` joins, grants the product to pay at the studio
(a newcomers-only offer once per person and studio, under a per-person lock) and books, in **one transaction**. Any
refusal leaves nothing: 404 `product.not_found`, 409 `offer.ended`, `offer.not_newcomer`, `session.full`,
`session.not_bookable`. The one partial answer: when the studio asks for a health declaration (docs/31), a newcomer
can't have signed it yet, so the join and the pass commit and the answer says `next: health_declaration`; the app
shows the declaration and then books. Last touch on the booking, first touch on the membership.

### 12.4 A full, cancelled or past class (SL-3)

`GET …/sessions/{id}` says `past` and, when the class is full, cancelled or past, offers up to three upcoming
classes with room in the next 14 days, the same class type first (`alternatives`, #424). A story lives longer than
one class.

### 12.5 A member's invite (SL-8)

A member's own link (`member_card`, `referral`) carries `show_name` (default on, switched in their share sheet; the
update is limited to their own link, #426). `GET /public/studios/{slug}/links/{code}` answers the target and, only for
such a link with the switch on, their **first name**: the first word of the name the studio holds for them. Never a
surname, a photo, tenure or attendance. The lookup is under the slug because a code is unique within one studio only.

### 12.6 Inside Instagram, Facebook or TikTok (SL-7)

A story's link opens in the app's own browser, where Google sign-in is blocked and passkeys usually fail. The app
detects it by user agent and offers only the email code (once SES allows it, #304) and the password, no Face ID and
no install prompt; after booking, a "פתיחה בדפדפן" card. A real phone check is part of SO4.

### 12.7 Link previews (SL-9)

Crawlers don't run JavaScript. `client-web`'s build output carries a Cloudflare Pages `_worker.js` (free plan, no
workflow change): a request to `/s/*` from a known preview crawler gets a small page with `og:title`,
`og:description` and `og:image` (HTML-escaped studio text, S-C); everything else passes to the static app with its
`_headers`. The pictures come from `GET …/cover` and `…/sessions/{id}/cover`: a 302 to the studio's or the class's
presigned picture, else the studio's icon (#426).

### 12.8 After booking (SL-10)

The confirmation, what to bring, "הוספה ליומן", "שליחה לחברה" (the member's own invite link), and only then the offer
to add the studio to the home screen, never inside an in-app browser.

### 12.9 The public surface's protections (S-A to S-D, D24)

| Threat | Answer |
|---|---|
| A burst of anonymous requests takes every Lambda execution and the whole API answers 503 (seen on dev 2026-10-20: 70 parallel reads, 50 503s) | Own route keys for `GET /api/v1/public/{proxy+}` and the public join, throttled on the stage at 10 rps (burst 12) and 2 rps (burst 4), both bursts together below the API's reserved concurrency, validated in the config (#417). No WAF (N-4). |
| One address or one account makes join or link requests without end | Counters in `identity.rate_counters` (migration 0037, #419): joins 10 per address and 3 per account an hour, share links 30 per account an hour. 429 `rate_limited` with `Retry-After`. The numbers are config (`RateLimits:*`); a counter keeps a SHA-256, never an address. |
| Telling a suspended studio from one that never existed (S-B) | The same 404 body and headers on every public route (#423's test). |
| A person's data in public JSON (S-B) | Exact key lists per answer in the tests; only an instructor's public profile with consent, and an inviter's first name under SL-8. Member-only class details are never read by the public queries. |
| Studio text as markup (S-C) | Text everywhere: JSON, `<title>`, React text, Canvas `fillText`, escaped `og` tags. |
| Joining without a verified email, or a `returnTo` off the studio (S-D) | 403 `account.email_not_verified`; `returnTo` is a same-origin path under `/s/<slug>/`, checked by `safeReturnTo`. |
| Staff collecting the bring-a-friend reward through a studio link | Staff links can't use `referral` or `member_card` (K5-1, #421). |
| A browser or proxy keeping a person's data | Every answer without its own caching is `private, no-store` (#422); public reads are `public` and carry no user. |

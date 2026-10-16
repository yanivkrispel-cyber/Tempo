# Communications LLD (Phase 4, part one: notifications)

> **Status:** Proposed (night board #136, B7). On 2026-10-16 Kris approved building steps 1 to 4 and 6 of section
> 13 with D-3, D-4, D-5, D-6, D-8 and D-9 as provisional defaults (day board #176). D-1, D-2 and D-7 wait for Kris,
> so step 5 (email) is not built.
> **Audience:** Kris, Ofir, the agents.
> **Scope rule:** Platform Core stays industry-neutral; a studio's wording lives in its templates, not in code.
> **Decision policy:** Statements marked **Proposed** become **Decision** when Kris accepts them (or stays silent
> on the default, as with docs/27 to docs/29). Statements marked **Open** need Kris.

Phase 4 of `docs/24` is "communications, files, integrations". This document covers the first word: how a
notification leaves the in-app inbox of docs/29 and reaches a person by email or push, under their preferences,
at a sane hour, in Hebrew that reads right to left. Files (uploads, scanning) and integrations (connections,
generic webhook intake) get their own LLDs when a vertical needs them.

## 1. Scope

In:

- the notification kinds the skeleton already raises (booking created, waitlisted, promoted, promotion failed,
  session cancelled, waitlist expired, attendance marked) and the two staff messages of docs/29 section 16
  (a message to everyone booked, a studio announcement);
- reminders the studio switches on: "your class is tomorrow at 18:30", "your class starts in 2 hours", "your pass
  ends in 7 days", "you have 1 entry left";
- three channels: the in-app inbox (exists), email, web push;
- templates per kind, per studio, per locale, versioned; Hebrew right to left by default;
- a person's preferences per studio: which kinds, which channels, quiet hours; marketing opt-in apart;
- a delivery queue with the states of `docs/14` section 5, retries, dedupe, and a status the console shows;
- one provider adapter per channel: SES for email, Web Push (VAPID) for push, none for SMS or WhatsApp yet.

Out, and where it goes:

| Item | Where |
|---|---|
| SMS and WhatsApp | after the pilot: a provider contract, Israeli consent rules, and a per-message cost; the adapter seam is here |
| Transactional email for sign-up, password reset, invitations | Cognito sends sign-up and reset today; invitations by email join this queue in part two, once the domain exists |
| Marketing campaigns, newsletters, segments | Phase 6 CRM |
| Two-way messaging (replies, chat) | not planned |
| Files and integrations of Phase 4 | their own LLDs |

## 2. Constraints that shape this design

- **$0 until revenue (ADR-0021).** Email needs a domain and SES; both are decisions in section 14. SES is
  pay-per-use at fractions of a cent per message (verify the current price before the first send); web push costs
  nothing (the browser vendors deliver it); the inbox costs a row. So the pilot can run on inbox + push alone.
- **Public repo, private people.** Templates render names from the database at send time; the delivery row keeps
  ids, never the rendered text or the address (docs/29 section 10 rule, same as the audit log). Logs carry
  delivery ids only.
- **One worker, one queue (ADR-0008).** Delivery is a message on the work queue, like the daily jobs, not a new
  Lambda. Reminders are found by a daily and an hourly job, not by one timer per booking.
- **Hebrew first.** Every template has a Hebrew version; Latin inside it (a class name, a studio name) goes in
  `<bdi>`; email bodies carry `dir="rtl"`; the plain-text part keeps the same order.
- **Consent (docs/27).** Service notifications about a person's own bookings need no opt-in; reminders are a
  preference; marketing is an explicit opt-in with its own consent record (P-4).

## 3. Model

| Term | Meaning |
|---|---|
| Kind | A notification type, `booking.promoted`, `session.cancelled`, `reminder.class_tomorrow`. The catalog is code (section 5); a studio cannot invent kinds, only word them. |
| Template | The words for one kind, one studio (or the platform default), one locale, one channel, with a version. |
| Preference | What a person wants from one studio: per kind group, which channels; quiet hours; marketing opt-in. |
| Request | "Tell this person about this subject": one row per (kind, subject, person), created by the domain code that today writes the inbox item. |
| Delivery | One attempt line per channel for a request: queued, sending, accepted, delivered, failed, dead. |
| Channel | `inbox`, `email`, `push`. Later `sms`, `whatsapp`. |
| Subscription | A browser's push endpoint for a person, with its keys; several per person. |

```text
domain event ──▶ request ──▶ (preferences, quiet hours, consent) ──▶ delivery per channel ──▶ adapter ──▶ status
                   │
                   └──▶ inbox item (always, as today)
```

The inbox item of docs/29 stays the source of truth of "what the app shows"; a request is what the delivery
pipeline works from. The two share the kind and the `data` ids.

## 4. Channels

### 4.1 Inbox (exists)

`notifications.inbox_items` as in docs/29. Phase 4 adds nothing but `request_id` so the console can show the
delivery status next to the item.

### 4.2 Email (SES)

**Proposed.**

- One verified sending domain per environment (section 14, D-1); the studio's name in the display name
  (`"סטודיו נועה" <no-reply@<domain>>`), never the studio's own address: SPF/DKIM/DMARC are ours.
- Reply-To is the studio's contact address when it has one (docs/26 organization profile), so a member's reply
  reaches the desk, not us.
- Multipart: `text/html` with `dir="rtl" lang="he"` on `<html>` and `<body>`, a 600 px single column, system
  fonts, no remote images except the studio logo (when files arrive); and `text/plain` with the same lines.
- Every email carries the List-Unsubscribe header pointing at the preferences page; marketing emails also carry a
  one-click unsubscribe (RFC 8058).
- Bounces and complaints come back through SES → SNS → the work queue (`notifications.ses_event`): a hard bounce
  marks the contact point `undeliverable`, a complaint sets every marketing preference off and is audited. The SES
  reputation alarms of the observability stack already exist.
- No attachments in part one. The `.ics` of docs/29 section 16 (A4) stays a download in the app.

### 4.3 Web push (VAPID)

**Proposed.**

- client-web registers a service worker and asks for permission from the settings page, never on first load; the
  subscription (`endpoint`, `p256dh`, `auth`) is stored per person per studio, with the user agent's family for the
  list in settings.
- One VAPID key pair per environment, the private key in SSM, the public key in the app's build. Sends go through
  the worker with the `web-push` protocol (RFC 8030, encryption RFC 8291); a 404 or 410 from the push service
  deletes the subscription.
- Payload: title, body, a URL inside the app (`/classes/{sessionId}`, `/inbox`), the kind, and the inbox item id, so
  tapping the notification opens the right screen and marks the item read.
- iOS Safari needs the app installed to the home screen (PWA) before push works; the settings page says so.

**Built (P4, day board #176), server side.** Where it differs from the proposal above:

- The public key is served by `GET /push/vapid-public-key` (404 `push.unavailable` until a person runs
  `tools/scripts/vapid-keys.mjs`), not baked into the app's build, so a rotation needs no app release.
- **Payload: ids only.** It carries the kind, the studio id, the inbox item id, the ids in `data`, and the class name
  and start for a class notice. There is no title, body or message text. The service worker (client-web) renders the
  text per kind from these, so nothing a person wrote passes through Google, Mozilla, Microsoft or Apple.
- **Endpoints:** only the four browser push services are accepted (`*.fcm.googleapis.com`,
  `*.push.services.mozilla.com`, `*.notify.windows.com`, `*.push.apple.com`; https on the default port). They are
  checked at subscribe time and again before every send, so the worker never calls an address a client made up. At
  most 10 devices per person per studio; the oldest goes.
- **Sending:** encryption is RFC 8291 `aes128gcm` and the VAPID token is RFC 8292 ES256 with a 12-hour expiry, both
  in .NET with no package. TTL is one day. Urgency is high for the member's own bookings and normal otherwise.
- **Answers from the push service:**
  - 404 or 410 deletes the subscription.
  - 429 or 5xx is retried after 1 min, 10 min and 1 h, then marked dead.
  - Any other 4xx is dead at once, with `http_<status>`.
- **Keys:** `/tempo/<env>/push/vapid-public-key` (String) and `/tempo/<env>/push/vapid-private-key` (SecureString
  under the default `aws/ssm` key). Only the worker can read the private key.

### 4.4 SMS, WhatsApp

Not in part one. The channel enum carries them so preferences and templates can be filled in later without a
migration; the router refuses them until an adapter exists.

## 5. Kinds and the catalog

**Proposed.** Kinds are code, grouped for preferences:

| Group | Kinds | Default channels | Preference |
|---|---|---|---|
| `bookings` (service) | `booking.created`, `booking.waitlisted`, `booking.promoted`, `booking.promotion_failed`, `booking.cancelled_by_staff`, `session.cancelled`, `session.changed`, `waitlist.expired`, `attendance.no_show` | inbox + push; email when there is no push subscription | channels only; cannot be switched off |
| `reminders` | `reminder.class_tomorrow`, `reminder.class_soon`, `reminder.pass_ending`, `reminder.entries_low` | inbox + push | on/off per kind, channels, timing |
| `studio` | `studio.message_to_booked` (A3), `studio.announcement` | inbox + push + email | channels; can be switched off except for `message_to_booked` |
| `marketing` | `marketing.campaign` (Phase 6) | email | explicit opt-in, own consent record |

Staff kinds (`roster.changed`, `booking.late_cancel`, `tripwire` and friends) are part two; staff read the console.

## 6. Templates

**Proposed.**

- `notifications.templates (organization_id NULL for the platform default, kind, locale, channel, version, subject,
  body, status draft|active|retired, created_by, created_at)`. The active row per (studio, kind, locale, channel) is
  used; a studio without its own row falls back to the platform default.
- Variables are typed and closed: `{{person.firstName}}`, `{{session.classTypeName}}`, `{{session.startsLocal}}`,
  `{{session.room}}`, `{{studio.name}}`, `{{pass.entriesLeft}}`, `{{link.session}}`, `{{link.preferences}}`. Unknown
  variables fail validation; no expressions, no loops, no HTML from the studio in the subject.
- Rendering escapes everything; the body is Markdown-light (paragraphs, bold, one link style) turned into the HTML
  skeleton of section 4.2, so a studio cannot inject markup. The console shows a preview with the demo studio's
  data.
- Time and date variables are rendered in the studio's time zone and locale, in words that read right to left
  ("יום שלישי, 21.10, בשעה 18:30"), never with a dash between two numbers.
- Push uses the same template with `subject` as the title and the first paragraph as the body (120 characters).

## 7. Preferences, quiet hours, consent

**Proposed.**

- `notifications.preferences (organization_id, person_id, group, channel, enabled, updated_at)` with the defaults of
  section 5 when no row exists; `notifications.quiet_hours (organization_id, person_id, starts_local, ends_local,
  time_zone)` defaults to 22:00 to 08:00 in the studio's time zone (D-4).
- Inside quiet hours a `reminders` or `studio` delivery waits until the window ends; a `bookings` delivery about a
  class that starts inside the window (a promotion at 23:00 for a 07:00 class) goes out at once: the person asked
  to be told.
- Marketing opt-in is a consent record of docs/27 (`marketing_email`), not a preference row, so it has history and a
  wording version (P-4). The preferences page shows it with the wording Kris writes.
- A person's `email` contact point marked `undeliverable` (bounce) routes email deliveries to `skipped` with that
  reason until the address changes.
- Erasing a person (docs/27) deletes preferences, quiet hours, subscriptions, requests and deliveries; the audit
  keeps counts only.

## 8. The delivery queue

**Proposed.**

- `notifications.requests (organization_id, id, kind, person_id, subject_type, subject_id, data jsonb, dedupe_key,
  created_at)` with `dedupe_key = {kind}:{subject_id}:{person_id}:{occurrence}` unique (docs/14 section 6);
  `occurrence` is the session date for reminders and the inbox item id for events, so a retried job never doubles a
  message.
- `notifications.deliveries (organization_id, id, request_id, channel, status, attempts, next_attempt_at,
  provider_message_id, last_error_code, created_at, updated_at)`; `status` runs `queued → sending → accepted →
  delivered`, or `failed → retry_scheduled → dead`, plus `skipped` with a reason (`preference_off`, `quiet_hours`,
  `no_subscription`, `undeliverable`, `no_consent`).
- The domain code that writes an inbox item also writes the request in the same transaction and an outbox row
  (ADR-0008); the worker's `notifications.deliver` handler takes the request, applies section 7, writes one delivery
  per channel and sends. Retries: 1 min, 10 min, 1 h, then dead; a dead delivery shows on the dashboard (B3 widget
  "work queue, dead letters" already exists; a `notifications.dead` count joins it).
- Reminders: the daily job (03:15, exists) creates `reminder.class_tomorrow` and `reminder.pass_ending` requests for
  the next day; an hourly schedule creates `reminder.class_soon` for sessions starting in the next 2 to 3 hours.
  Both idempotent through the dedupe key.
- The console (admin-web) shows per person the last 30 deliveries with status and reason; the member app shows
  nothing but the inbox.

## 9. API

Section 9 of the contract, `x-tempo-planned` until built, as docs/29 did. Preferences and studio settings are live
since P3 (day board #176); push subscriptions and the VAPID key come with P4.

| Route | Who |
|---|---|
| `GET/PUT /organizations/{id}/me/notification-preferences` | the member: channels per group, reminder switches, quiet hours (`getMyNotificationPreferences`, `updateMyNotificationPreferences`) |
| `GET/POST /organizations/{id}/me/push-subscriptions`, `DELETE .../{subscriptionId}` | the member (client-web; `listMyPushSubscriptions`, `createMyPushSubscription`, `deleteMyPushSubscription`) |
| `GET /push/vapid-public-key` | any signed-in account (`getVapidPublicKey`) |
| `GET/PUT /organizations/{id}/notification-settings` | `organization.view` / `organization.settings.manage`: the studio's quiet hours and reminder timing (`getNotificationSettings`, `updateNotificationSettings`) |
| `GET/PUT /organizations/{id}/notification-templates/{kind}` | `settings.manage` (console; preview included) |
| `GET /organizations/{id}/people/{personId}/deliveries` | `people.view` (console) |
| `POST /organizations/{id}/announcements` | `bookings.manage` (studio announcement) |
| `POST /organizations/{id}/sessions/{id}/messages` | A3 of docs/29 section 16 (already planned) |

## 10. Audit

`notification.sent` (kind, channel, delivery id, no text), `notification.failed`, `preference.changed`,
`template.changed` (with the version), `consent.marketing` through docs/27. Never the rendered text, never the
address.

## 11. Worker and infrastructure

- Message types: `notifications.deliver`, `notifications.ses_event`, `notifications.reminders_hourly`.
- A third and fourth EventBridge Scheduler schedule (hourly reminders; SES event intake is SNS → SQS, no schedule).
  Still inside the free tier.
- SES: domain identity, DKIM, a configuration set with event publishing to one SNS topic, the sandbox lifted (a
  support request, D-1). SSM: the VAPID private key, the SES configuration set name.
- The worker gets `ses:SendEmail` on the identity and nothing else new.
- Dashboard (B3): deliveries by status per hour, SES bounce and complaint rates (the alarms exist for prod).

## 12. Apps

- client-web: a settings page (channels per group, quiet hours, push on this device, marketing opt-in with the
  consent wording), and the service worker; the inbox stays as in #128.
- admin-web: templates per kind with preview, a person's deliveries on the person card, the announcement dialog,
  the message-to-booked dialog (A3).
- Both: the design-system `Switch`, `TimeRange` and a `TemplatePreview` component (Ofir's area).

## 13. Delivery plan

1. This LLD and the contract rows (`x-tempo-planned`), SYNC 3a on board #176.
2. Migration 0014 (0011 to 0013 went to docs/29 section 16 and #124): templates, preferences, quiet hours,
   subscriptions, requests, deliveries; RLS, platform grants; deliveries join the retention job (B4) at 90 days
   (D-6).
3. Requests and the `notifications.deliver` handler with the inbox-only router (nothing new leaves the app yet);
   the dedupe key; tests through the real host. **Built (P3):** every inbox writer goes through
   `NotificationRequests` (request, inbox item and a delivered inbox line in one transaction); the
   `notifications.deliver` job writes one push line per request (`preference_off`, `no_subscription`,
   `channel_unavailable`, or queued until quiet hours end, D-4); preferences and studio settings are live; erase
   and merge delete a person's notification rows.
4. Web push: VAPID keys, subscriptions, the adapter, the client-web settings page and service worker. **Built
   (P4), server side**, as described in section 4.3:
   - After a notification commits, the API puts one `notifications.deliver` message on the work queue. The hourly
     schedule of P5 picks up anything missed.
   - The worker claims due push lines with `FOR UPDATE SKIP LOCKED` (a line stuck in `sending` for 10 minutes is
     taken again), sends to every device, and audits `notification.sent` or `notification.failed`.
   - The service worker and the subscribe button are client-web's part (S3).
5. Email: domain and SES (after D-1 and D-2), the HTML/RTL skeleton, bounces and complaints, the preferences link.
   **Waiting on D-1** (and D-2, D-7): not built on board #176.
6. Reminders: daily and hourly jobs, timing preferences.
7. Templates per studio with preview in the console; the announcement and message-to-booked dialogs.

Steps 1 to 4 and 6 cost nothing and need no domain (ADR-0021: VAPID keys in SSM standard parameters, the hourly
reminder schedule inside the Scheduler free tier, no paid push service). Step 5 is the first one that waits on Kris.

## 14. Decisions for Kris

On 2026-10-16 (board #176) Kris approved D-3, D-4, D-5, D-6, D-8 and D-9 as **provisional**: they are built as
written and stay open to a change from Kris. D-1, D-2 and D-7 are **open**.

| Id | Question | Default if nobody objects |
|---|---|---|
| D-1 | The sending domain and the SES account | Tempo has no domain yet (project decisions). Email waits for one; until then the pilot runs on inbox + push. When bought: `mail.<domain>` as the SES identity, SES in eu-central-1, sandbox lifted by support request. |
| D-2 | Who is the sender | `"<studio name>" <no-reply@mail.<domain>>`, Reply-To the studio's contact address. Never a studio's own domain in part one. |
| D-3 | Channels in the pilot | Inbox and web push on by default; email once D-1 exists; no SMS or WhatsApp. |
| D-4 | Quiet hours default | 22:00 to 08:00 in the studio's time zone; service notifications about a class inside the window still go out. |
| D-5 | Reminder timing | Class tomorrow at 18:00 the evening before; class soon 2 hours before; pass ending 7 days before; entries low at 1 left. Studio-level settings, members may switch each off. |
| D-6 | What the delivery log keeps, and for how long | Ids, status, provider message id and error code; 90 days, then the retention job (B4) deletes them. Never the text or the address. |
| D-7 | Marketing opt-in wording | Kris writes it in Hebrew with the consent texts (P-4); one checkbox, off by default, its own consent record. |
| D-8 | Push on iOS | Supported only as an installed PWA; the settings page explains it. No native app in Phase 4. |
| D-9 | Who may edit templates | `settings.manage` (owner and admin); a changed template takes effect at the next send, old versions are kept. |

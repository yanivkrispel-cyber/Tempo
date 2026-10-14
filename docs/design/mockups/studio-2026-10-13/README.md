# Studio mockup, 2026-10-13

The first clickable mockup of Tempo for a pilates and yoga studio ("סטודיו נשימה", owner מיכל, member נגה).
Kris reviewed it on 2026-10-13 ("נראה טוב"). It is the visual reference for the apps work (`apps/client-web`,
`apps/admin-web`). It is a design reference, not a spec: the API contract (`contracts/openapi/`) and the LLDs win
where they differ.

Source: the Claude Design canvas `C6ACbPk9SGC4yLA3WbaoVE` (private to Kris). These files are a copy of its
`project/` folder, taken 2026-10-14.

## How to read the files

Each screen is one `*.dc.html` file. They are written for the Design canvas runtime (`<x-dc>`, `<sc-for>`, `<sc-if>`,
`{{...}}` bindings, `support.js`), so they do not render by opening them in a browser. Read them as source:

- The markup uses the design system classes (`tp-*`) from `packages/design-system`, RTL (`dir="rtl" lang="he"`).
- The sample data and the click behaviour (tabs, dialogs, waitlist, toasts) are in the `<script type="text/x-dc">`
  block at the end of each file, as a small `Component` class with `state` and `renderVals()`.
- `ds/tempo/` is the design system snapshot the canvas used (v0.3 tokens and `bundle.css`). The package in
  `packages/design-system` is the source of truth.
- `canvas.json` lists the boards, their size and their order.

Plan prices (190 and 290 ₪) and all names are invented placeholders. No pricing has been decided.

## Screens

| Row | File | Size | What it shows |
|---|---|---|---|
| Owner console (desktop) | `Main.dc.html` | 1440 × 1080 | Today: occupancy, active members, waitlists, the day's classes, the class running now |
| | `Schedule.dc.html` | 1440 × 1080 | Weekly schedule, new class dialog |
| | `ClassDetail.dc.html` | 1440 × 1080 | Registrants, waitlist auto-promote, cancel dialog |
| | `Members.dc.html` | 1440 × 1080 | Member list, search by name or phone |
| | `MemberProfile.dc.html` | 1440 × 1080 | Member card, renew dialog |
| Member app (phone) | `AppHome.dc.html` | 390 × 844 | Next class, week strip, the day's classes |
| | `AppBook.dc.html` | 390 × 844 | Schedule, booking bottom sheet, waitlist |
| | `AppClass.dc.html` | 390 × 844 | Class detail, cancel booking |
| | `AppBookings.dc.html` | 390 × 844 | Upcoming bookings and history |
| | `AppProfile.dc.html` | 390 × 844 | Plan, studio, notifications, account |
| Tempo team (platform admin) | `PlatformHome.dc.html` | 1440 × 1080 | Lifecycle counts, 10-studio backup tripwire card |
| | `Studios.dc.html` | 1440 × 1080 | Studio list |
| | `StudioDetail.dc.html` | 1440 × 1080 | Entitlements, audit, suspend with type-to-confirm |
| | `Impersonate.dc.html` | 1440 × 1080 | Support sign-in: ticket, reason, MFA, warning banner |
| | `NewStudio.dc.html` | 1440 × 1080 | Four-step new studio wizard |

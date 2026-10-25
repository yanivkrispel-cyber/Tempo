# Runbook: a 15-minute demo of Tempo for a studio owner

Written on 2026-10-25 (board #494, K3, decision R-5) and rehearsed on dev the same day. The point of the demo is to
**learn from the owner**, not to sell: show the day as they live it, then ask (last section). Everything runs on dev,
at $0. Every person in the studio is fictional (`@example.com`), except the presenter's own test users.

## What you need

- **A laptop** with the console signed in as a studio owner: https://tempo-studio-console.pages.dev
- **A phone** with the member app signed in as a member of the same studio: https://tempo-members.pages.dev
  (installed to the home screen if you can, so it looks like an app).
- **The studio:** `test-studio-1` (shown as "YOGAZ"), owned by Kris's test user `studio1`, with `member1` as a member.
  The two sign-ins and their password are on Kris's private test-users page, **never in this repo**. Not
  `tempo-smoke-studio`: e2e runs use it, so its names, sales and lists are e2e leftovers.

## Ten minutes before

1. **Make the week look lived in.** From the repo root, signed in to AWS (`aws sso login --profile tempo`):

   ```text
   TEMPO_DEMO_PASSWORD='<studio1 password>' node tools/scripts/demo-studio.mjs fill \
     --email <studio1 address> --studio test-studio-1
   ```

   It books the studio's fictional people who hold an active pass into the next seven days' classes that are still
   empty: the smallest class fills with two waiting, and the others are about two thirds full. It never books a real
   person and never touches a class someone already booked. It prints the counts; the rehearsal on 2026-10-25 made
   48 bookings and one waitlist. (Passwords stay out of shell history if you type a leading space, or set the
   variable in a separate step.)
2. **Name the owner.** The console greets the signed-in user by their first name. `studio1` is called "בעלת סטודיו 1",
   so the greeting reads "בוקר טוב, בעלת". Before a real demo, give it a real-looking name. The console has no
   rename yet, but the name belongs to the account: sign in to the member app as `studio1` once and change it
   with the pencil on the profile. Or present with your own owner account.
3. **Check there's a class still to come today.** Today's screen and OwnerLive need one. If the day is over, the demo
   still works from tomorrow ("מחר" on today's screen).
4. **Phone:** open the member app once, so the first load (about 3 seconds cold) happens before the owner watches.

## The walk (15 minutes)

| Min | Where | Show | Say |
|---|---|---|---|
| 0–3 | Console, **היום בסטודיו** | The greeting, today's classes with their fill, the full class with its waitlist, this month's sales, the week's occupancy grid, "מה קורה בסטודיו" (bookings arriving live) | "This is the first screen every morning: who's coming, what's full, what needs you." |
| 3–5 | Console, **מערכת שבועית** | The week at a glance; open the full class; its roster and the waitlist; "הודעה לרשומים" | "A class is a page: who's in, who's waiting, one message to all of them." |
| 5–8 | **Phone**, member app | Home (next class, the week); **מערכת**, pick a class, choose a device, book; the "אני בפנים" story card after booking | "Your members book themselves, see their pass, and share the class to Instagram." |
| 8–10 | Console, **OwnerLive** (from today's next class) | The clock, arrived of booked, the room map, "סריקת כרטיס כניסה" | "At the desk during class: who arrived, who's where." |
| 10–12 | Console, **כרטיסיות ומנויים**, **אנשים** | The products; a person with their pass, entries left and history | "Punch cards and memberships, sold at the desk and tracked here." |
| 12–15 | Console, **דוחות**, **פרסום** | Visits, occupancy, new and active members; the week's story for Instagram, the A4 poster with a QR to the week | "What worked this month, and the posts that bring people in." |

Things to avoid during the walk: the import, roles and audit pages (they're for setup, not for a first look), and
any e2e studio.

## Ask, then listen (the reason for the demo)

Write the answers down, word for word if you can. Each one is a task or a decision later.

1. What do you use today for the schedule, bookings and payments, and what does it cost you a month?
2. What annoys you most in it, and what would make you switch?
3. Who books: the members themselves, WhatsApp to you, or the desk?
4. How do members pay you today (cash, transfer, Bit, a terminal), and do you need invoices from the system?
5. What did you see here that you'd use tomorrow, and what's missing for you to try it with real members?

## Afterwards

Undo the bookings `fill` made (it remembers them in `<tmpdir>/tempo-demo-fill-<studio id>.json`; their entries return):

```text
TEMPO_DEMO_PASSWORD='<studio1 password>' node tools/scripts/demo-studio.mjs unfill \
  --email <studio1 address> --studio test-studio-1
```

Leaving them in place is harmless (dev, fictional people). They age out as the classes pass.

## Rehearsal, 2026-10-25

Run on dev at `main` `56d33e4`, before the four computer-layout PRs of board #494 landed: the owner at 1280 px,
the member at 360 px (Pixel 7). What it showed:

- Works end to end: sign-in (the console through the Hosted UI, the member app through the branded sign-in and its
  passkey offer, "לא עכשיו"), today, the week, a class, OwnerLive, people, passes, reports, publish; on the phone the
  home, the timetable, a class with the device map, and the profile with the pass.
- **Gap found:** a full class (4 of 4, one waiting) shows "8 פנויים מתוך 12" on the member's class page. The device
  map counts the room's 12 devices, not the class's 4 places. Avoid opening that class on the phone during a demo
  until #503 is fixed.
- The greeting uses the test user's first name ("בעלת"); see step 2 above.
- OwnerLive on a class that has ended shows 0 of 0; open it on the next class.

# Where the 19 clicks to the first class go (P3 F8)

For Kris and Ofir. This note is a decision aid, and nothing in it has been built (board #627, LR-4, KR-9). None of the
options adds anything that bills.

## The short version

The dry run takes 19 clicks from sign-in to the first weekly class. Only 9 of them are needed for that class. Another 3
create the pass product, which a member needs to book a regular class. The remaining 7 are the brand and the room, and
both can wait. The checklist asks for those two first, so a new owner pays for them before reaching what matters.

Recommendation: do option A before the pilot, and keep option B for later if pilot owners stall during setup.

## The 19 clicks, step by step

The steps come from `tests/e2e/specs/pilot-p3/pilot-p3.spec.ts`, in the spec's order. The last run was `mw57w00d`, on
`main` `f903c0a`. Clicks include `click`, `tap`, `check` and `uncheck`; typing and picking from a list are not counted.

| # | Step | Screen | Clicks | What the clicks are | Needed for the class? | Needed for a booking? |
|---|---|---|---|---|---|---|
| 1 | Sign in | Console, then Hosted UI | 2 | Sign in, submit | Yes | Yes |
| 2 | Open the studio | New studio form | 1 | Open | Yes | Yes |
| 3 | Brand | Settings | 3 | Menu, a colour, save | No | No |
| 4 | Room | Rooms | 4 | Menu, new, save, save the map (D20) | No | No |
| 5 | Class type | Class types | 3 | Menu, new, save | Yes | Yes |
| 6 | Pass product | Passes | 3 | Menu, new, save | No | Yes, for a regular class |
| 7 | First weekly class | Weekly schedule | 3 | Menu, new, create | Yes | Yes |

That makes 19 clicks over seven screens.

- **Room:** the new class dialog offers "בלי חדר". Without a room the owner types the capacity by hand.
- **Pass product:** a regular class refuses a booking without a valid pass (`booking.no_valid_pass`, `BookingService.cs`).
  Only an event set to pay at the studio needs no pass. F8 in `pilot-readiness.md` said the pass product isn't needed
  for the first booking; this PR corrects that line.
- **The shorter paths have not been run.** The 9 and the 12 below are counted from the code, not measured. The spec
  always takes the full path.

| Path | Clicks to a class |
|---|---|
| Today, as the spec runs it | 19 |
| Skip the brand and the room, keep the pass product (a member can book) | 12 |
| Skip the pass product too (nobody can book a regular class yet) | 9 |

The join link adds 3 clicks after these, whichever path the owner takes.

## Options

The effort figures are estimates and include tests and the 360 and 1280 px checks.

| | A. Reorder the checklist | B. One "first class" form | C. Open the studio with starter data |
|---|---|---|---|
| What changes | Brand and room move after the first booking and read as optional. The join link moves up. | One form after opening the studio: class name, length, day, time, capacity, and an optional punch card. | The studio opens with a starter class type and punch card. |
| Clicks to a bookable class | 12 | About 4 | About 6 |
| Effort | About half a day | 1 to 2 days | About 1 day |
| Where | `SetupChecklist.tsx` and `docs/pilot/owner-first-hour.md` | admin-web only, using the existing create calls | Backend. No migration expected, not yet confirmed. |
| Main cost | Members may first see a studio with no logo or colours. Early classes may have no room. | A new screen to maintain. If the second call fails, the type exists and the class doesn't, so that case needs handling. | Every studio starts with rows it didn't choose. The checklist would mark those steps done. Names differ between pilates and yoga. |

## Recommendation

- **A, before the pilot.** It costs the least and removes the 7 clicks that don't help the first booking. Nothing is
  taken away from the owner, because the checklist is a guide and every screen stays open. The brand step should stay
  easy to find, since the owner will want it before inviting real members.
- **B, only if needed.** It gives the biggest saving but adds a screen, so it should wait for evidence that owners
  really stall during setup. `docs/pilot/interview-guide.md` is the place to ask.
- **C, not recommended.** It saves fewer clicks than B and leaves data in the studio that the owner has to clean up.

The map dialog (1 click, P3 F5) stays in every option, because D20 decided it. Removing it would reopen D20.

## What we need from you

Choose A, B, C or none. Nothing happens until you do.

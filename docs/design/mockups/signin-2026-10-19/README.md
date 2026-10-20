# Branded sign-in mockups, design B (2026-10-19)

Kris chose design B, "glass over the studio", on board #380 (D22). These are the three boards from the design canvas,
saved as plain HTML so [O] can build O3b against them (docs/36):

| File | Board | What it shows |
|---|---|---|
| `Main.html` | `Main` (phone, 390 x 844) | The studio's photo, a glass sheet with the email field, "send me a code", Face ID, "built with Tempo" |
| `GlassCode.html` | `GlassCode` (phone) | The six-digit code step, resend countdown, "sign in with a password", the Face ID offer |
| `GlassDesktop.html` | `GlassDesktop` (1280 x 800) | The desktop layout: the sheet on the start side, the next class over the photo |

- The studio here is fictional ("סטודיו נשימה", `noga@example.com`) and its accent is ocean; the screens take the
  real studio's brand (docs/35).
- The studio photo is a placeholder: the canvas's picture is not committed to this public repository.
- Email code is not available tonight (docs/36 F-2): the first screen builds with the password and the passkey first,
  and the code step is ready behind the same flag.

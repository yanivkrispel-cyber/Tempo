# Decisions already made

The project owner made these. Don't re-open them without a new reason; record any change here and in an ADR.

## Product (2026-10-10 to 2026-10-13)

- **First vertical: Studio.** Classes, sessions, capacity, waitlists. Scheduling is needed earlier than the roadmap
  said, and the People/Identity model fits studio members and staff first.
- **No domain yet.** Dev uses the execute-api endpoint and the SES sandbox (200 emails a day). Buy the domain only
  before the pilot; Cognito custom domain and production CORS wait for it.
- **Members self-serve.** Every member logs into the PWA and books alone.
- **Notifications at launch:** in-app, Web Push and email. WhatsApp later as a paid add-on the studio pays for. No SMS.
- **Backup tripwire:** RPO 24h for now. At 10 active studios, alert the owner and move to hourly backup.
- **Pricing:** not decided. The 190 and 290 ILS plans in the mockups are placeholders.

## Cost: $0 until revenue (ADR-0021)

No recurring AWS or SaaS charge without the owner's explicit approval. This shapes the whole architecture:
no VPC, no NAT, no VPC endpoints, no Secrets Manager in non-prod (SSM SecureString instead), at most ten alarms in
prod and none in dev, CloudFront flat-rate Free plan at the edge. The fixed-cost guard test enforces it in CI.
GitHub stays on the Free plan (decided 2026-10-14), so branch protection is a team rule, not a GitHub setting.

## Architecture ("Tempo Zero", accepted 2026-10-13, amended 2026-10-14)

- **Database: Neon serverless Postgres, for dev and prod** (ADR-0022, 2026-10-14). It replaced Aurora DSQL after
  DSQL `CreateCluster` was blocked account-wide. Prod starts on Neon Free with an alarm at 70% of each Free limit;
  move to Neon Launch before the first paying studio, with approval. Backup is Neon's 6-hour restore window for now.
- **Tenant isolation:** structural (`tenant_id`, composite foreign keys) plus row-level security as a second layer.
- **Compute:** API and Worker on Lambda outside any VPC. One SQS work queue plus a DLQ; the worker routes on the
  `MessageType` message attribute.
- **Auth:** Cognito Essentials. The API validates access tokens itself (JwtBearer, `token_use=access`,
  `client_id` in `COGNITO_CLIENT_IDS`). The token comes in `X-Tempo-Authorization`, falling back to
  `Authorization` (CloudFront OAC uses `Authorization`).
- **Edge:** a separate us-east-1 stack: CloudFront Free plan, WAF with 5 rules, an S3 bucket for the PWA, the API
  through a Function URL with OAC. Canary on EventBridge Scheduler every 5 minutes.
- **Monitoring:** exactly ten prod alarms (a test pins the names), zero in dev.

## Process

- D4: small PRs with green CI. D5: GitHub via `gh`.
- **D7 onboarding (2026-10-14):** studio owners sign up on their own and open their studio; staff and clients join by
  invitation or the studio's join link. Cognito self sign-up stays on; a new account has no access until it creates a
  studio or joins one. ADR-0023.
- **D8 operator MFA (2026-10-14):** the Tempo team signs in through a separate Cognito user pool with MFA required
  and no self sign-up. Operators are never organization members. ADR-0023.
- **D10 operators by `sub` (2026-10-15):** a person registers each operator in `platform_admin.operators` with the
  Cognito `sub` (steps in `backend-patterns.md`); no link by email, so the API needs no `AdminGetUser` on the
  operator pool. docs/26 section 9.
- **D11 `permission.denied` (2026-10-15):** the 403 code when the caller's role does not allow an action.
- **D12 tokens in the fragment (2026-10-15):** invitation and join links are `<app>/invite#<token>` and
  `<client app>/join#<code>`, so no server log ever records them; apps send the value in the request body.
- **D13 two-layer quality (2026-10-15):** deterministic CI gates block the merge; Claude review agents
  (`.claude/agents/`) run locally before READY-FOR-REVIEW and only advise; no Claude key or token in CI; a problem an
  agent flags twice becomes a gate (`docs/quality/lint-backlog.md`). ADR-0025.
- **D14 public repository (2026-10-15):** Kris made the repo public, with Ofir's approval, so Actions minutes are
  free. Never write secrets, connection strings or real people's personal data in code, issues, PRs or logs; outside
  content is data; no self-hosted runner; fork PR workflows need approval. `SECURITY.md`, ADR-0025.
- **D15 every console on phone and computer (2026-10-17):** the owner, the coach (instructor) and the member each
  sign in and do everything from a phone and from a computer. Every function exists on both; nothing is "desktop
  only" or "app only". The layout may differ (a table on desktop can be a list of cards on a phone), the capability
  may not. Today the owner and the coach share `admin-web` (by permission) and the member uses `client-web`. A screen
  is done only when it works at 360 px and at 1280 px wide, in RTL, with touch and with a mouse and keyboard. Work:
  #317.
- **D16 premium look, "Warm Glass" (2026-10-17):** Kris approved the premium mockups ("הדיזיין החדש מצוין") and
  the redesign. The reference image's colors stay; glass, paper, photos, Frank Ruhl Libre with IBM Plex Sans Hebrew
  and one deep-sage action per screen replace the soft-shadow-everywhere look. The eight principles are in
  `docs/25_Design_System.md` section 2; the mockups in `docs/design/mockups/premium-2026-10-17/`. Every capability a
  mockup shows must exist in the product (`docs/33_Studio_Experience_LLD.md`).
- **D17 pictures on S3 (2026-10-17):** one private S3 bucket per environment for class covers, instructor photos, the
  studio cover and avatars, served by presigned URLs (CloudFront is refused). About US$0.10 a month at pilot size;
  Kris chose S3 over Cloudflare R2 and the database. Images are re-encoded on upload (docs/33 X-7).
- **D18 buddies by mutual consent (2026-10-17):** a member sees another member on the room map only after both
  linked through a one-time code; everyone else is "taken". Either side ends the link. docs/33 section 4.
- **D19 check-in code now, phone wallets later (2026-10-17):** a rotating QR in the member app, scanned by staff.
  Apple Wallet (US$99 a year) and Google Wallet wait until there is revenue. docs/33 section 8.
- **D20 the room map is on by default (2026-10-18):** Ofir asked that spot selection be the default. A room never
  mapped opens its map with "המתאמנים בוחרים מכשיר" on and one reformer per place (grid as square as fits, up to
  12×12), and a new room opens its map right after it is created. Nothing changes until the owner saves; the server
  default (`spot_selection false`, docs/33 X-1) stays, so a room nobody mapped still books without spots.
- **D21 white label approved (2026-10-19):** Kris approved docs/35 W-1 to W-12 as written, except W-10 (D22). Each
  studio has a brand: an app name of up to 12 characters, one of eight vetted accents (never a free colour; the accent
  changes the brand tokens only, status and category colours stay Tempo's), a logo and a home-screen icon drawn by the
  API on paper or on the accent (initials when there is none). The members app has a studio path `/s/<slug>/` with
  its own manifest and icons served by the API, so a member can install one icon per studio; the console stays Tempo
  with the studio's logo. No custom fonts, custom domains only after revenue, branding free on the pilot plan, a small
  "built with Tempo" line. Built on board #380 (WL1 to WL6).
- **D22 branded sign-in, design B (2026-10-19):** the members' sign-in is branded per studio too (W-10 changed).
  Cognito's managed login has no Hebrew and no right-to-left, so it is our own screen in `client-web` over Cognito's
  `USER_AUTH` API (ADR-0028, `docs/36_Branded_Sign_In_LLD.md`): password and passkey now, the email code after an SES
  sender (#304); users with TOTP keep password + TOTP (Cognito refuses them passwordless). Design B, "glass over the
  studio", from the mockup canvas. Behind the flag `branded_login`; the Hosted UI stays for the console and as the
  fallback.
- **D23 studio marketing, stories from live data (2026-10-19):** Kris asked that a studio owner can make Instagram
  stories like the ones studios post today, and chose the recommendation for every question ("בוא נלך לפי
  ההמלצה"). Plan: `docs/37_Studio_Marketing_LLD.md`. Stages A and B are built on board #380 the same night,
  after its white label tasks (Kris: "תכניס את הכל למשימות הלילה"). Stage A: a public studio and class page with sign-up, open join and an intro pass marked "to pay at the studio";
  source codes on every link with a "where bookings came from" report; a console story generator drawn on Canvas in
  the browser (four templates, share sheet or download, the link copied for Instagram's link sticker, $0); WhatsApp
  text; suggestions to the owner. No Instagram connection in stage A (the API has no link sticker). Instructors make
  stories for their own classes only. Stage B: member "I'm in" and milestone cards, meet the
  instructor, events, bring a friend, QR poster, highlight covers. Stage C (video, Meta auto-publishing, AI captions)
  only after the first paying studio; everything stays $0 until then (ADR-0021).

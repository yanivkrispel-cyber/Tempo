# Runbook: Kris's steps before the first pilot studio

Written on 2026-11-03 (board #584, K5). Each step is what only Kris can do, as exact commands, about ten minutes
each. Run them from the repo root on Kris's machine, in PowerShell, signed in to AWS (`aws sso login --profile
tempo-mgmt`; the `tempo` profile must work). No step prints a password or a token.

## 1. The operator account and the e2e clean-up (#301)

**State on 2026-11-03 (checked read-only):** the dev operator pool `tempo-dev-operators` has three confirmed users,
and `platform_admin.operators` has one active row whose subject matches one of them. So the registration of #301 is
most likely done; what was missing is a way to sign in, because there is no operator app. MFA on the dev pool is
optional since #316 (staging and production require it).

1. See what the clean-up would remove (reads only):

   ```powershell
   node tools/scripts/e2e-cleanup.mjs
   ```

2. Remove it. This opens the operator sign-in in the browser; after you sign in, the clean-up runs with a fresh
   operator token that never shows on screen:

   ```powershell
   node tools/scripts/operator-token.mjs -- node tools/scripts/e2e-cleanup.mjs --apply
   ```

   It suspends and removes every `e2e-…` studio (32 on 2026-11-03), then deletes the e2e logins. Port 5175 must be
   free.

3. If step 2 answers 403 `operator.not_registered`, check your user and register it:

   ```powershell
   .\tools\scripts\register-operator.ps1 -Email <your operator email> -DryRun
   .\tools\scripts\register-operator.ps1 -Email <your operator email>
   ```

   The second command prints one `INSERT`: paste it into the Neon SQL editor (project `tempo-dev`, database
   `neondb`) as the owner, then run step 2 again.

Deleting dev data is your call: nothing in this step runs without you.

## 2. The support contact (PL-4)

The console's "עזרה ויצירת קשר" shows how a studio owner reaches you. Choose an email address or an https link (a
WhatsApp link works), then:

```powershell
aws ssm put-parameter --name /tempo/dev/support/contact --type String --value "<email or https link>" --overwrite --profile tempo --region eu-central-1
```

The API reads it within ten minutes; no deploy is needed. Anything that is neither an email address nor an https
link is ignored and the contact stays hidden. To check: `GET /api/v1/support-contact` from the console, or open the
help screen once O4 is live. To remove it: `aws ssm delete-parameter --name /tempo/dev/support/contact --profile
tempo --region eu-central-1`.

## 3. The phone test (#305, #294 WL6)

On a real phone (one Android with Chrome and, if you have it, one iPhone with Safari):

1. Open https://tempo-members.pages.dev, sign in as a member of a test studio, and install the app (Android: the
   install button; iPhone: Share, then "Add to Home Screen").
2. In the installed app: profile, notifications, turn on "התראות במכשיר הזה" and allow them.
3. From the console on a computer, send that studio a message (people, "הודעה לכל הסטודיו"). The phone should show a
   push within a minute.
4. Share a class link in WhatsApp to yourself: the preview should show the studio's picture and the class name.

Then write **"done"** on the board, and K11 and O8 clean up the dev seed.

## 4. The pilot pulse (any time)

How each studio is doing, counts only, safe to paste into a board comment:

```powershell
node tools/scripts/pilot-pulse.mjs           # real studios
node tools/scripts/pilot-pulse.mjs --all     # with the e2e studios
```

## 5. The lawyer and the pilot offer

- Read `docs/legal/` (the drafts) and take `docs/legal/questions-for-lawyer.md` to one session: #306 (the health
  form), P-4 (the consents) and #548 (privacy policy and terms) together. The app texts change only after that.
- The pilot offer is `docs/pilot/pilot-offer.md` (three months free, no commitment). Keep it or change it on the
  board. The price after the pilot stays outside the repo.
- Three candidate studios: write them outside the repo (it is public). The interview guide is
  `docs/pilot/interview-guide.md`.

## 6. Answers the board waits for

Write each on the board:

- **"workflow OK"** for #558 and #559 (CI workflow changes; K10 runs them only after that);
- **"done"** after the phone test (step 3);
- **#97:** A, B or C; **#562 and #564:** the defaults apply unless you change them;
- **OK** to delete the six leftover `node_modules`-only folders under `C:\Dev\Tempo-worktrees\`.

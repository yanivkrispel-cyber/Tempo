# ADR-0028: The Members' Sign-In Is Our Own Screen Over Cognito's API

- **Status:** Accepted
- **Date:** 2026-10-19
- **Approved by:** Kris (board #380: W-10 changed to a branded sign-in per studio, design B, decisions L-1 to L-7)
- **Owners:** Engineering (Kris's machine: Cognito; Ofir's machine: the screens)
- **Related:** ADR-0024 (the apps' sign-in through `authClient`), ADR-0027 (the apps on Cloudflare Pages), ADR-0021
  (zero fixed cost), docs/35 (white label), docs/36 (the build plan), #124 (no password flow in the browser)

## Context

Kris wants the members' sign-in page in the studio's look, in Hebrew, right to left (W-10, 2026-10-19). Until now
both apps sign in through Cognito's Hosted UI with the authorization code flow, and #124 kept every direct password
or SRP flow closed to the browser.

Cognito's managed login (the newer hosted pages) was checked on 2026-10-19: it supports 12 languages and **no Hebrew
and no right-to-left**; its text and font can't be changed; per app client it takes only a logo, a background,
colours and corner radius ([managed login localization](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html#managed-login-localization):
de, en, es, fr, id, nl, it, ja, ko, pt-BR, zh-CN, zh-TW). The classic Hosted UI is less customizable still. Neither can show a Hebrew, right-to-left
page dressed per studio.

## Decision

1. The member app (`client-web`) gets its own sign-in screens (design B), which call Cognito's public user-pool API
   from the browser with **choice-based sign-in (`USER_AUTH`)**: password, passkey, and later the email code. Sign-up,
   confirmation and password reset use `SignUp`, `ConfirmSignUp`, `ResendConfirmationCode`, `ForgotPassword` and
   `ConfirmForgotPassword`. The tokens go into the existing `authClient` session.
2. The **same member app client** gets `ALLOW_USER_AUTH` next to its OAuth flows (L-2). Its id, the token audience
   and the API's validation don't change. It stays a public client with no secret. This supersedes #124 for the member
   app client only: passwords now travel from the browser to Cognito over TLS, never to our API. The console client
   keeps only the Hosted UI (W-9).
3. The pool allows `PASSWORD` and `WEB_AUTHN` as first factors. The passkey's relying party ID is the members app's
   host. `EMAIL_OTP` waits for an SES sender (#304), because Cognito sends email codes only through SES (docs/36 F-2).
4. MFA stays optional with TOTP; Cognito itself refuses passwordless factors to users with MFA, so owners and staff
   sign in with password and TOTP (docs/36 F-3).
5. The screens are behind the build flag `branded_login`; with it off the Hosted UI path is unchanged.

## Consequences

- **Good:** a premium Hebrew sign-in in each studio's look; passkeys (Face ID, fingerprint) for members; no secret
  ever reaches our API; no new service, no new cost (the pool is on Essentials already).
- **Cost to us:** we own the sign-in UI and its error handling (docs/36 section 4.1), and its security review on
  every change (docs/36 section 7). A branded page is easier to imitate than Amazon's (T-1); passkeys are the answer.
- **Lock-in:** a passkey is bound to its relying party ID. Moving the members app to its own domain (W-8) means
  members register their passkey again; passwords keep working.
- **Reversible:** turning `branded_login` off brings back the Hosted UI for everyone; removing `ALLOW_USER_AUTH`
  closes the API path.

## Alternatives considered

- **Managed login with branding:** no Hebrew, no right-to-left, fixed text. Rejected (the reason for this ADR).
- **A sign-in proxy on our API** (the browser sends the password to us, we call Cognito): puts passwords through our
  Lambda and logs, against L-7. Rejected.
- **Option A (Amazon's page) and option C (editorial)** of the mockup canvas: Kris chose B.

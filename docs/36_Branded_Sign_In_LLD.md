# Branded Sign-In LLD (our own sign-in screen over Cognito)

> **Status:** Approved in its decisions (board #380, L-1 to L-7, Kris 2026-10-19: W-10 changed, design B chosen).
> This document is the build plan for K4 (Cognito) and O3 (the screens).
> **Audience:** Kris, Ofir, the agents.
> **Related:** docs/35 (white label, W-10), docs/09 (authentication), ADR-0028 (why our own screen), ADR-0024 (the
> apps' sign-in through `authClient`), ADR-0027 (the apps on Cloudflare Pages), #124 (no password flow in the
> browser, superseded for the member app by ADR-0028), #304 (the email domain), the mockup canvas
> `JEW4jCeK7q78M7SC1bysYU` (boards `Main`, `GlassCode`, `GlassDesktop`).

## 1. What and why

Kris changed W-10 on 2026-10-19: the members' sign-in page is branded per studio, in Hebrew, right to left, in design
B ("glass over the studio"). Cognito's managed login can't do that: it has no Hebrew and no right-to-left, and its
text and font can't change (verified on 2026-10-19 in
[managed login localization](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html#managed-login-localization):
12 languages, no Hebrew; ADR-0028). So the member app gets its **own screen** that calls
Cognito's public user-pool API from the browser. Passwords, codes and passkeys go from the browser to Cognito only;
nothing secret reaches our API. The console keeps the Hosted UI (W-9), and the member app keeps it as the fallback
when the flag is off.

## 2. Verified Cognito facts (AWS docs, read 2026-10-19)

| # | Fact | What it means for us | Source |
|---|---|---|---|
| F-1 | Choice-based sign-in (`USER_AUTH`), passwordless codes and passkeys are **Essentials** features. Our customer pool `tempo-dev-users` is on **Essentials** (checked with `describe-user-pool` on 2026-10-19); new pools default to it. | No plan change. Essentials keeps its free monthly-active-user allowance; nothing new is billed at pilot size (ADR-0021). | [Feature plans](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html) |
| F-2 | **Email one-time codes as a sign-in factor need the Essentials plan *and* the user pool's email set to Amazon SES** ("Requires Essentials feature plan or higher and Amazon SES email configuration"). Our pool sends with `COGNITO_DEFAULT`. | **L-5: `EMAIL_OTP` waits for the email domain (#304).** Tonight ships the password and the passkey. The code screens are built and tested against a mocked Cognito, so they are ready when SES is. | [Email settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html), table "Message options", note 1 |
| F-3 | "Users can either have MFA *or* sign in with passwordless factors." In an MFA-**optional** pool, a user who set up MFA can only use password flows in choice-based sign-in ("can set up WebAuthn but can't sign in with passkey"); a user without MFA can use passwordless factors. A passkey satisfies MFA only with `FactorConfiguration = MULTI_FACTOR_WITH_USER_VERIFICATION`; ours is `SINGLE_FACTOR`. | **L-6:** owners and staff with TOTP sign in with **password + TOTP** in our screen. Members without MFA may use a passkey. Passwordless never skips anyone's MFA, because Cognito itself refuses it. The screen does not offer the Face ID step to a user whose sign-in asked for TOTP. | [MFA, "Things to know"](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html#user-pool-settings-mfa-prerequisites) |
| F-4 | Passkeys: the relying party ID defaults to the pool's domain, but "you can also configure your RP ID to be any domain name not in the public suffix list (PSL)". `WEB_AUTHN` must come with at least one other first factor. Up to 20 passkeys per user; registration needs a signed-in user (`StartWebAuthnRegistration` and `CompleteWebAuthnRegistration` with the access token). | `pages.dev` is on the PSL, but **`tempo-members.pages.dev` is not**, so it should be a valid RP ID, and a browser accepts an RP ID equal to the page's host. **K4 sets it and verifies with a real registration on dev**; if Cognito or Chrome refuses it, the passkey waits for the members app's own domain and this table says so. Changing the RP ID later means users register again, so the custom domain (W-8) will cost one re-registration. | [Authentication flows, passkeys](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html#amazon-cognito-user-pools-authentication-flow-methods-passkey) |
| F-5 | Refresh tokens issued by API sign-in work at the OAuth token endpoint (`grant_type=refresh_token`) of a pool with a domain, as well as with `REFRESH_TOKEN_AUTH`. | The tokens from our screen go into today's `authClient` session unchanged; its refresh and revoke keep working. | [Refresh tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html) |
| F-6 | After `ConfirmSignUp`, its `Session` signs the user in with `USER_AUTH` without asking again. | Sign-up, then the six digits, then straight into the studio. | Authentication flows, "Passwordless sign-in", after sign-up |
| F-7 | Access tokens from API sign-in carry the `aws.cognito.signin.user.admin` scope, which lets the user call token-authorized user-pool operations (read and change their own attributes, passkeys, MFA, `DeleteUser`). | K4 limits the member client's write attributes to `email` (as the console client already is). See threat T-7. | [API authorization models](https://docs.aws.amazon.com/cognito/latest/developerguide/authentication-flows-public-server-side.html) |

## 3. Cognito configuration (K4)

Only the customer pool and its **member** app client (`tempo-<env>-client-web`) change. The console client and the
operator pool don't.

| Setting | Value |
|---|---|
| Member app client `ExplicitAuthFlows` | add `ALLOW_USER_AUTH` (choice-based); keep refresh; keep `ALLOW_ADMIN_USER_PASSWORD_AUTH` only where `enableSmokeTestSignIn`. No `ALLOW_USER_PASSWORD_AUTH`, no SRP. |
| Member app client OAuth | unchanged (authorization code, the Hosted UI stays the fallback). Same client id, so the audience, the API's validation and `authClient` don't change (L-2). |
| Member app client attributes | `writeAttributes` = `email` only; `readAttributes` = `email`, `email_verified` (F-7). |
| Pool `SignInPolicy.AllowedFirstAuthFactors` | `PASSWORD`, `WEB_AUTHN`. `EMAIL_OTP` only after #304 (F-2). |
| Pool `WebAuthnConfiguration` | `RelyingPartyId` = the members app's host (dev: `tempo-members.pages.dev`), `UserVerification = preferred`, `FactorConfiguration = SINGLE_FACTOR` (F-3, F-4). |
| Pool MFA | unchanged: optional, TOTP. |
| Members app CSP | `connect-src` already allows `https://cognito-idp.<region>.amazonaws.com` (for TOTP setup). Nothing else is added for sign-in (L-7). |

Nothing new is created, so nothing can bill (ADR-0021, `fixed-cost-guard`).

## 4. The calls the screen makes

All are the public user-pool JSON API: `POST https://cognito-idp.<region>.amazonaws.com/`, header
`X-Amz-Target: AWSCognitoIdentityProviderService.<Operation>`, `Content-Type: application/x-amz-json-1.1`, with the
member app's `ClientId`. No secret, no AWS signature.

| Step (design B) | Call | Body (the parts that matter) | Next |
|---|---|---|---|
| Email, then "המשך" | `InitiateAuth` | `AuthFlow: USER_AUTH`, `AuthParameters: { USERNAME: <email> }` (no preferred challenge) | `AvailableChallenges` (e.g. `PASSWORD`, `WEB_AUTHN`) and a `Session`. The screen shows Face ID first if `WEB_AUTHN` is there and the device supports it, else the password field. |
| Password | `RespondToAuthChallenge` | `ChallengeName: SELECT_CHALLENGE`, `ChallengeResponses: { USERNAME, ANSWER: PASSWORD, PASSWORD }`, `Session` | tokens, `SOFTWARE_TOKEN_MFA`, or a `PASSWORD` challenge that wants the password again in a second `RespondToAuthChallenge` (handle both shapes) |
| Password in one step (known user, "use password") | `InitiateAuth` | `AuthParameters: { USERNAME, PREFERRED_CHALLENGE: PASSWORD, PASSWORD }` | tokens, or `SOFTWARE_TOKEN_MFA` |
| Face ID / fingerprint | `RespondToAuthChallenge` (`ANSWER: WEB_AUTHN`) or `InitiateAuth` with `PREFERRED_CHALLENGE: WEB_AUTHN` | then `navigator.credentials.get({ publicKey: <CREDENTIAL_REQUEST_OPTIONS> })` | `RespondToAuthChallenge` `ChallengeName: WEB_AUTHN`, `ChallengeResponses: { USERNAME, CREDENTIAL: <AuthenticationResponseJSON> }` → tokens |
| Six-digit app code (owners, staff) | `RespondToAuthChallenge` | `ChallengeName: SOFTWARE_TOKEN_MFA`, `ChallengeResponses: { USERNAME, SOFTWARE_TOKEN_MFA_CODE }`, `Session` | tokens |
| Email code (after #304) | `InitiateAuth` with `PREFERRED_CHALLENGE: EMAIL_OTP`, then `RespondToAuthChallenge` `ChallengeName: EMAIL_OTP`, `{ USERNAME, EMAIL_OTP_CODE }` | | tokens |
| Sign up | `SignUp` | `Username: <email>`, `Password`, `UserAttributes: [{ Name: email }]` | `UserConfirmed: false`, `CodeDeliveryDetails` and a `Session` to keep for the confirmation (the six-digit code goes by email; Cognito's default sender works for this) |
| The six digits after sign-up | `ConfirmSignUp` | `Username`, `ConfirmationCode`, and the `Session` from `SignUp` | a `Session`; then `InitiateAuth` `USER_AUTH` with that `Session` signs in (F-6) |
| "שלחו שוב" (after 60 s) | `ResendConfirmationCode` | `Username` | |
| Forgot password | `ForgotPassword`, then `ConfirmForgotPassword` | `Username`; then `Username`, `ConfirmationCode`, `Password` | back to the password step |
| The one-time Face ID offer after a sign-in | `StartWebAuthnRegistration`, `navigator.credentials.create(...)`, `CompleteWebAuthnRegistration` | `AccessToken`; then `AccessToken`, `Credential: <RegistrationResponseJSON>` | 200, empty body |

`USERNAME` is the email: the pool signs in by email alias. `PreventUserExistenceErrors` is on for the client, so
sign-in answers the same way for an unknown email and a wrong password.

### 4.1 The error codes the screen handles

`__type` in the JSON error (the part after `#`). The screen maps each to one Hebrew message; none of them may say
whether an email exists.

| `__type` | When | Screen |
|---|---|---|
| `NotAuthorizedException` | wrong password, unknown user (with user-existence errors prevented), expired `Session`, a refused factor | "האימייל או הסיסמה לא נכונים" on the password step; on an expired session, back to the email step |
| `UserNotConfirmedException` | signed up, never confirmed | to the six-digit confirmation, with a resend |
| `PasswordResetRequiredException` | an admin reset | to forgot-password |
| challenge `NEW_PASSWORD_REQUIRED` | a user an administrator created | a "choose a password" step (`RespondToAuthChallenge` with `NEW_PASSWORD`) |
| challenge `MFA_SETUP` or `SELECT_MFA_TYPE` | the pool asks the user to set up MFA | send them to the Hosted UI, which can |
| `CodeMismatchException` | wrong confirmation, reset or TOTP code | "הקוד לא נכון" |
| `ExpiredCodeException` | old code | "הקוד פג. שלחנו חדש" plus resend |
| `UsernameExistsException` | sign-up with a taken email | the same neutral text as success ("אם האימייל פנוי, שלחנו קוד"), then the confirm step; a real owner goes to sign-in or reset from there |
| `InvalidPasswordException` | sign-up or reset against the policy (12+, upper, lower, digit, symbol) | the policy in words, under the field |
| `InvalidParameterException` | malformed input; also a reset for a user without a recovery method | "בדקו את הפרטים ונסו שוב" |
| `LimitExceededException`, `TooManyRequestsException`, `TooManyFailedAttemptsException` | Cognito's rate limits and lockout | "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות" |
| `CodeDeliveryFailureException` | the code email couldn't be sent | "לא הצלחנו לשלוח קוד. נסו שוב" |
| `WebAuthnNotSupportedException`, `WebAuthnNotEnabledException`, `WebAuthnChallengeNotFoundException`, `WebAuthnRelyingPartyMismatchException`, `WebAuthnOriginNotAllowedException`, `WebAuthnCredentialNotSupportedException`, `WebAuthnConfigurationMissingException`, `WebAuthnClientMismatchException` | the passkey path fails | fall back to the password step quietly; the offer is not shown again on this device |
| a browser `NotAllowedError` from `navigator.credentials` | the person cancelled Face ID | stay on the step, offer the password |
| `UserLambdaValidationException`, `ResourceNotFoundException`, `InternalErrorException`, network error | misconfiguration or outage | "משהו השתבש. אפשר להיכנס גם דרך העמוד הרגיל" with a link to the Hosted UI path |

## 5. Handing the tokens to `authClient`

`authClient` (`packages/api-client/src/auth/authClient.ts`) stores `{ accessToken, refreshToken, expiresAt }` under
`tempo.client-web.session` in `localStorage` and refreshes at `<cognito domain>/oauth2/token`. The screen gets
`AuthenticationResult { AccessToken, RefreshToken, ExpiresIn, IdToken }`.

- A new method on `AuthClient`, `adopt({ accessToken, refreshToken, expiresIn })`, stores the session exactly as the
  code exchange does (`toSession`) and notifies listeners. The ID token is not kept (the app doesn't use it today).
- The sign-in screen's Cognito calls live in one module next to it (`cognitoSignIn.ts` in `@tempo/api-client/auth`),
  which never logs and never stores anything itself. The `Session` strings live in component state only.
- After `adopt`, the app goes to `returnTo` (5.1); the existing `POST /api/v1/session` provisioning runs as after a
  Hosted UI sign-in.
- Sign-out is unchanged: revoke the refresh token, then the Hosted UI `/logout` (harmless when there was no Hosted
  UI session).

### 5.1 `returnTo`

Sign-in and sign-up take `returnTo`, kept only when it is a **same-origin path under `/s/<slug>/`** of the studio
whose screen it is (for `/login`, any path `safeReturnTo` accepts). Anything else becomes the studio's home. It is read
from the query on the login URL, checked once, and never taken from another source (open redirect, T-6).

## 6. The flag

`branded_login` (L-4): `VITE_BRANDED_LOGIN=true` at build time, off by default. Off: every "sign in" goes to the
Hosted UI as today. On: `/login` and `/s/<slug>/login` show our screen, with a small "כניסה בדרך הרגילה" link to the
Hosted UI path. Dev turns it on only after K's review of O3 and a green live check (K6). No production exists.

## 7. Threats and answers (L-7)

| # | Threat | Answer |
|---|---|---|
| T-1 | **Phishing look-alike:** a copy of our branded page on another domain collects passwords. A branded page is easier to copy than Amazon's. | The passkey is bound to the RP ID, so a look-alike can't use it; we offer it after every sign-in. Our API never accepts a password, so a stolen password works only against Cognito, behind its own lockout. The page lives only on the members app's origin; the CSP's `frame-ancestors 'none'` stops framing. Later: the studio's custom domain (W-8). |
| T-2 | **Account enumeration** through different answers for "no such email" and "wrong password", or through sign-up and reset. | `PreventUserExistenceErrors` is on; the screen shows one text for both, and the sign-up and reset texts are neutral (4.1). Resend waits 60 s. `AvailableChallenges` does show whether an email has a passkey (Cognito's design); the screen therefore never words the Face ID button as "your passkey", and a failed passkey falls back to the password like any other answer. |
| T-3 | **Code brute force** (confirmation, reset, TOTP, later email code). | Cognito limits attempts and locks out with growing timeouts (five wrong MFA codes start it); six digits; codes expire. The screen doesn't retry on its own. |
| T-4 | **Token theft** from the page (XSS) or from storage. | Same storage as today (`localStorage`, ADR-0024), behind the existing strict CSP (`script-src 'self'`, no inline scripts). No new place holds tokens; `Session` strings and the password live in memory only. Access tokens last an hour; sign-out revokes the refresh token. |
| T-5 | **Secrets in logs:** a password, code or token in our logs, analytics or errors. | Nothing goes to our API. The module never calls `console.*` with request bodies; errors keep only `__type`. A unit test asserts that no `console` method is called with a password or code during a full mocked flow. |
| T-6 | **Open redirect** through `returnTo` after sign-in or sign-up. | 5.1: only `/s/<slug>/...` of the same studio (or `safeReturnTo` on `/login`); never a full URL, `//` or `/\`. Unit tests cover each refused form. |
| T-7 | **The admin-scoped access token** (F-7) lets a member change their own Cognito attributes or delete their Cognito user directly. | Write attributes limited to `email` (a change needs verification, `keepOriginal`); `DeleteUser` only removes their own sign-in, the API account then can't be used and is cleaned up by the existing deletion path. The console client already has this scope (two-step setup). |
| T-8 | **MFA skipped** through a passwordless factor. | Cognito refuses passwordless for users with MFA (F-3); our screen never offers a way around it. |
| T-9 | **A studio's look used to mislead** (a fake studio styled like a real one). | Brands are chosen by studio owners from eight accents and their own logo (docs/35); the screen says the studio's name, and "built with Tempo". Reported studios are suspended by the operator. |

## 8. Build steps

| Step | What | Lane |
|---|---|---|
| L0 | This document and ADR-0028 | K (K3) |
| L1 | Cognito: section 3, with CDK tests and `cdk diff`; deploy to dev; a real passkey registration on `tempo-members.pages.dev` decides F-4 | K (K4) |
| L2 | The screens of design B behind `branded_login`, `adopt()` and `cognitoSignIn.ts`, unit tests with a mocked Cognito for every row of 4.1, 360 and 1280 px | O (O3) |
| L3 | Live check: `/s/test-studio-1/login` signs the smoke user in with a password and lands in the studio | K and O (K6) |
| Later | `EMAIL_OTP` after #304; the passkey on the custom domain (W-8) | |

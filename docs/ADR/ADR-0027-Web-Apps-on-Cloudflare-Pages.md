# ADR-0027: Web Apps on Cloudflare Pages While CloudFront Is Refused

- **Status:** Accepted
- **Date:** 2026-10-17
- **Approved by:** Kris ("מאשר", 2026-10-17)
- **Owners:** Engineering (Kris's machine: infrastructure)
- **Related:** ADR-0001 (AWS as the exclusive cloud), ADR-0009 (S3, CloudFront, WAF), ADR-0021 (zero fixed cost until
  revenue), ADR-0024 (frontend toolchain), #133 (Content-Security-Policy)

## Context

ADR-0009 serves the web apps from S3 through CloudFront, with a WAF web ACL on the Free plan. The first dev deploy on
2026-10-14 failed: "Your account must be verified before you can add new CloudFront resources". Support case
179198465900800 ended on 2026-10-17 with a refusal: CloudFront distribution creation is not available on the account,
there is no date, and a new request may be made once the account has a steady usage history. Amplify Hosting runs on
CloudFront, so it is blocked too.

Without CloudFront the apps run only on a developer's machine, against the dev API. A pilot studio and its members
need the apps on a public https address, on a phone and on a computer.

## Decision

1. In dev, `admin-web` and `client-web` are served by **Cloudflare Pages**, Free plan, one project each:
   `tempo-studio-console.pages.dev` (the studio console) and `tempo-members.pages.dev` (the members' app).
2. The API, Cognito, the database and everything else stay where they are. The apps call the API cross-origin on its
   execute-api URL (`VITE_API_URL`), as they already do on a developer's machine.
3. `deploy-development.yml` gets a `deploy-web` job. It runs after the API deployed and passed its smoke test, builds
   both apps with the API URL and the Cognito client ids from the CDK outputs, writes a `_headers` file, and publishes
   with Wrangler (Direct Upload, pinned version). The job is skipped with a warning while the secrets
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are missing.
4. The token has one permission, Account / Cloudflare Pages / Edit, on one account, and no zone permission. The
   Cloudflare account also holds an unrelated domain, which this token cannot read or change.
5. `_headers` carries the same headers CloudFront would: the Content-Security-Policy from
   `appContentSecurityPolicy` (#133) with the API origin added to `connect-src`, plus HSTS, `nosniff`, frame options
   and the referrer policy of CloudFront's managed SecurityHeadersPolicy (`infrastructure/lib/web/pages-headers.ts`).
6. The Pages addresses come first in the dev CORS origins and Cognito callback and logout URLs, so invitation and
   join links (`ADMIN_APP_URL`, `CLIENT_APP_URL`) point at them. localhost stays for developers.
7. The edge stack (`edge-stack.ts`) stays in the code, tested, with `enableFrontendHosting` and `enableWaf` off in
   dev. Production still plans CloudFront; if AWS still refuses it then, a new ADR decides.

## Cost

| Item | Fixed | Variable |
|---|---|---|
| Cloudflare Pages Free | $0 | $0: static requests are not metered; 500 deploys a month; 20,000 files a site |
| GitHub Actions | $0 | The repository is public |

## Consequences

- Tempo has a second non-AWS vendor after Neon (ADR-0001 amendment). The apps are static files with no secrets, so
  Cloudflare holds no customer data.
- No AWS WAF in front of the apps. Cloudflare's free DDoS protection covers the static sites. The API is unchanged:
  it was never behind the WAF in dev, and it keeps its throttling and authentication.
- The API is cross-origin: every call pays a CORS preflight, and the CSP names the execute-api origin.
- Invitation links built on a developer's machine against the dev API point at the Pages sites, not at localhost.
- Changing the API URL or a Cognito client id needs a rebuild, which the workflow does on every deploy.
- Under `apps/**`, a change now triggers the dev deploy too (it was ignored while no app was deployed).

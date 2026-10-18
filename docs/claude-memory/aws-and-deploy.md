# AWS and deploy

## Accounts and regions

- **Dev runs in the management account `687239340846`** (decided 2026-10-13), region `eu-central-1`.
  The edge stack lives in `us-east-1` because a CloudFront-scope WAF exists only there.
- A separate `tempo-dev` account (`254631022581`) exists but never finished activation. Don't use it.
- This account has no 12-month Free Tier; only Always Free, pooled across the Organization.
- Budget alerts fire on actual spend over $0.01 and on forecast over 100%; an anomaly alert at $1.

## Access

- Each developer signs in with their own IAM Identity Center user: `aws sso login --profile tempo-mgmt`.
- CDK cannot read SSO profiles directly here. Export the credentials first:
  `eval "$(aws configure export-credentials --profile tempo-mgmt --format env)"`.
- CI deploys through GitHub OIDC with the role `arn:aws:iam::687239340846:role/tempo-dev-github-deploy`, trusted
  only for `refs/heads/main` of this repo. There are no static AWS keys anywhere.

## Deploying

- Normal path: merge to `main`, then `.github/workflows/deploy-development.yml` builds, deploys and smoke-tests dev.
  Its last step is the install gate (`tools/scripts/pwa-check.mjs`, since 2026-10-18): a deploy whose apps lose
  their manifest `id` or the 192, 512 or maskable PNG icon goes red, because Android then won't install them.
- Manual path (announce it first, never during a CI run): `cdk diff`, review it, then
  `npx cdk deploy 'TempoDev/*' --require-approval never` from `infrastructure/`. Set `COMMIT_SHA` or health
  reports `version=local`.
- CDK is bootstrapped in both regions with `--bootstrap-kms-key-id AWS_MANAGED_KEY` (no paid KMS key).
- admin-web two-step sign-in setup (`/account/security`) is behind `VITE_COGNITO_MFA_SETUP=true`, which lets the sign-in
  that page starts (only that one) ask for `aws.cognito.signin.user.admin`. Turn it on only after the admin-web Cognito app client allows that scope
  (`OAuthScope.COGNITO_ADMIN` in `identity-stack.ts`, asked of Kris on #89 on 2026-10-15); otherwise sign-in fails
  with `invalid_scope`.

## Dev canary (`TempoDev/Canary`, Q10)

- `tempo-dev-api-canary` runs `GET /api/v1/health` every 5 minutes (no database) and, every 60 minutes, signs in as
  the smoke-test user and reads `/api/v1/me` plus one tenant route (wakes Neon about 24 times a day).
- No CloudWatch alarm (dev keeps zero, alarm-budget test). Each check keeps its last three results in
  `/tempo/dev/canary/<check>`; at two failures out of three it emails Kris through the SNS topic
  `tempo-dev-api-canary` (the subscription needs a one-time confirmation click), and again on recovery.
- Self-test of the alert path, kept apart from the real checks: invoke with `{"mode":"selftest","fail":true}` twice
  (the second one emails "[self-test] ... failing"), then with `{"mode":"selftest"}` twice (the second one emails
  "recovered"): `aws lambda invoke --function-name tempo-dev-api-canary --payload '<json>'
  --cli-binary-format raw-in-base64-out --profile tempo --region eu-central-1 out.json`.

## Limits and open AWS cases

| Limit | Value |
|---|---|
| Lambda memory | Capped at 512 MB in this account; dev config uses 512 (PR #20). |
| Lambda concurrency | 40 now; quota case 179192381800130 asks for 1000. Dev reserves 20 for the API (10 throttled parallel e2e runs on 2026-10-18 with 503s) and 5 for the outbox worker; 15 stay unreserved. |
| CloudFront | Refused on 2026-10-17 (case 179198465900800), no date. Dev apps are on Cloudflare Pages (ADR-0027). |
| Aurora DSQL | `CreateCluster` blocked account-wide (case 179195875300741). No longer needed after the move to Neon. |

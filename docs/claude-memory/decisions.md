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
- D7 (onboarding) and D8 (admin MFA) are open; ask the owner before the Phase 1 LLD.

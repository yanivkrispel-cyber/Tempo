# Security policy

Tempo is a multi-tenant platform for fitness studios. It is in early development: only a development environment
exists, and it holds no real customer data yet. We still want to hear about every weakness, now while it is cheap to
fix.

## Reporting a vulnerability

Report it privately through GitHub: **Security → Report a vulnerability** on this repository
(<https://github.com/yanivkrispel-cyber/Tempo/security/advisories/new>).

Please do not open a public issue, pull request or discussion for a vulnerability.

A useful report says:

- what is affected (file and line, endpoint, or AWS resource);
- how to reproduce it, step by step;
- what an attacker gains: another studio's data, someone else's account, a secret, higher privileges.

We acknowledge a report within 3 business days and tell you what we will do about it within 10. We credit you in the
advisory unless you ask us not to. There is no bug bounty.

## What we care about most

- **Tenant isolation:** one studio reading or changing another studio's data.
- **Authorization:** an endpoint that does more than the caller's role allows.
- **Personal data:** member details that leak into logs, audit records, error messages or URLs.
- **Secrets:** a credential, token or connection string anywhere in this repository, its history, issues or
  Actions logs.

## Testing rules

- Test only against code you run yourself (`docker-compose.local.yml` starts the local stack). Do not test against
  the deployed development environment: it runs on free-tier quotas, and a scan can take it down for the team.
- No denial-of-service, load testing, spam or social engineering.
- Stop and report as soon as you see data that is not yours.

## Supported versions

Only the `main` branch is supported. There are no releases yet.

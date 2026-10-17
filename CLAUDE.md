# Tempo: instructions for Claude Code

Claude Code loads this file at the start of every session, on every developer's machine. It is the team's shared
memory. Personal auto-memory (`~/.claude/projects/...`) stays on one machine and is not shared, so anything the
other developer needs goes here or in `docs/claude-memory/`.

## Team

| Person | GitHub | Role |
|---|---|---|
| Yaniv (Kris) Krispel | `yanivkrispel-cyber` | Project owner. Approves cost, product and architecture decisions. Prefers Hebrew. |
| Ofir Ben | `ofirbnaim1` | Developer (joined 2026-10-14). Admin on both AWS accounts through his own Identity Center user `ofir`. |

## What Tempo is

A multi-tenant SaaS for studios (pilates, yoga, fitness): a .NET 10 backend on AWS Lambda, Neon Postgres, a PWA
frontend, all infrastructure in AWS CDK (TypeScript). The first vertical is Studio: classes, sessions, capacity and
waitlists. Product and architecture docs are in `docs/` (start with `docs/00_Project_Overview.md`). Mandatory rules
for every developer and agent are in `docs/AGENTS.md`. Read the sections that matter to the task before changing code.

## Shared project memory

`docs/claude-memory/` holds the facts that git history and the code do not show. Read the files that touch the task:

| File | What it covers |
|---|---|
| [project-status.md](docs/claude-memory/project-status.md) | Where the project stands and what comes next |
| [decisions.md](docs/claude-memory/decisions.md) | Product and architecture decisions already made; don't re-ask them |
| [aws-and-deploy.md](docs/claude-memory/aws-and-deploy.md) | Accounts, regions, SSO, deploy, quotas, open AWS cases |
| [database-neon.md](docs/claude-memory/database-neon.md) | Neon project, branches per developer, SSM secrets, migrator |
| [design-system.md](docs/claude-memory/design-system.md) | The visual reference and the `@tempo/design-system` package |
| [local-dev-quirks.md](docs/claude-memory/local-dev-quirks.md) | Windows and tooling traps that cost time before |

**Keep it current.** When you learn a durable project fact (a decision, a new constraint, a trap), update the
matching file in the same PR as the change. One fact in one place; edit the existing line instead of adding a
duplicate. Dates are absolute (2026-10-14, not "yesterday"). Don't put secrets, tokens, connection strings or
personal data here.

## How we work (two developers, see CONTRIBUTING.md)

- `main` is the only long-lived branch. Never commit or push to it directly.
- One task = one short branch from an up-to-date `main` (`feat/...`, `fix/...`, `docs/...`, `chore/...`) = one PR.
  Keep PRs small; merge within hours, not days.
- A PR merges only when all five CI jobs are green and the other developer has approved it. GitHub Free cannot
  enforce this on a private repo, so check `gh pr checks <n>` yourself and never merge your own PR unreviewed.
- Merge with squash. The branch is deleted automatically.
- Merging to `main` deploys to dev automatically (`.github/workflows/deploy-development.yml`). Don't run
  `cdk deploy` against dev from a laptop while that workflow runs, and announce any manual deploy first.
- Database migrations: only one developer writes a new migration at a time; say so in the PR draft first.
- Several Claude sessions on one machine: one session per folder. Parallel work uses `git worktree add`.

## Hard rules

- No secrets in the repo: no `.env` with values, no keys, no connection strings. Secrets live in SSM Parameter
  Store (`/tempo/<env>/...`). Writing a secret is done by a human, not by Claude.
- $0 recurring cost until revenue (ADR-0021). Before adding any AWS or SaaS resource that can bill, state its
  monthly cost and get the project owner's approval. `infrastructure/test/unit/fixed-cost-guard.test.ts` fails CI on
  fixed-cost resources.
- Destructive or account-wide actions (deleting stacks, IAM changes, Neon branch deletes, force-push) need the
  owner's explicit approval each time.
- Code, comments, commit messages and docs are in English.
- Every console works on a phone and on a computer with the same functions (D15 in
  `docs/claude-memory/decisions.md`): owner, coach and member. A UI change is checked at 360 px and at 1280 px wide.

# Contributing to Tempo

Two developers work on Tempo, each on their own machine, each usually with Claude Code. This file is the working
agreement. `CLAUDE.md` gives Claude the same rules.

## One-time setup on each machine

1. Tools, at these versions:
   - Git and the GitHub CLI (`gh auth login`)
   - Node 22 (`.nvmrc`) and pnpm via Corepack (`corepack enable`; the version comes from `package.json`)
   - .NET SDK 10 (`global.json`)
   - Docker Desktop
   - AWS CLI v2
2. Clone and install:
   ```sh
   git clone https://github.com/yanivkrispel-cyber/Tempo.git
   cd Tempo
   git config pull.rebase true
   git config fetch.prune true
   pnpm install --frozen-lockfile
   dotnet restore Tempo.sln
   ```
3. AWS: sign in with your own IAM Identity Center user. Never copy another person's credentials.
   ```sh
   aws configure sso --profile tempo-mgmt   # region eu-central-1
   aws sso login --profile tempo-mgmt
   ```
4. Database: create your own Neon branch from `production` (see `docs/claude-memory/database-neon.md`) and keep its
   connection string in your local user secrets or shell, never in a tracked file.

## Daily loop

```sh
git switch main && git pull
git switch -c feat/short-name
# work, commit small, push early
git push -u origin HEAD
gh pr create --draft --fill        # draft PR from the start, so the other developer sees what you are on
```

- Keep the branch fresh: `git pull --rebase origin main` before pushing.
- Mark the PR ready when CI is green. The other developer reviews; the author merges with squash.
- After a merge, the other developer rebases any open branch on `main`.

## Rules that prevent collisions

| Area | Rule |
|---|---|
| `main` | No direct pushes, no force-push. Every change is a PR. |
| PR size | One task per PR. Aim for under about 400 changed lines. |
| Review | The other developer approves before merge. CI must be green (Backend, Infrastructure, Frontend, Contracts, Security). |
| Ownership | Agree who owns which area for the week (e.g. backend and infra vs. frontend and design system) to avoid editing the same files. |
| Migrations | One developer writes a new migration at a time. Announce it in the draft PR title. |
| Deploys | Dev deploys from CI on merge to `main`. A manual `cdk deploy` is announced first and never overlaps a CI run. |
| Secrets | Only in SSM Parameter Store. Never in git, chat or PR text. |
| Cost | Anything that can bill needs the owner's approval first (ADR-0021). |
| Shared memory | Durable facts go into `docs/claude-memory/` in the same PR. |

## Commit messages

Conventional style: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `chore: ...`. Present tense, says what
changes and why.

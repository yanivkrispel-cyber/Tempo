# ADR-0025: Two-Layer Quality - Gates Block, Agents Advise

- **Status:** Proposed (Kris approved the direction on 2026-10-15; approval of this text pending)
- **Date:** 2026-10-15
- **Approved by:** pending
- **Owners:** Engineering (Kris's machine: backend, CI, infrastructure; Ofir's machine: apps and packages)
- **Related:** ADR-0011, ADR-0021, `docs/AGENTS.md` sections 6 and 10, `SECURITY.md`

## Context

Two developers, each working with Claude Code, merged about 50 pull requests in two days. Each PR is reviewed by the
other developer's agent, but review attention does not scale with that pace. The CI checks that exist today (build,
unit and integration tests, CDK synth and tests, the fixed-cost guard, Redocly, gitleaks) catch what they were written
for and nothing else. Tenant isolation, authorization on new endpoints and personal data in logs are judged by a
reviewer reading the diff.

On 2026-10-15 the repository became public (Kris, with Ofir's approval), so Actions minutes no longer limit how much
CI can run. Everything in the repository, its issues, its PRs and its Actions logs is now readable by anyone. Outside
contributors can also open issues and fork PRs.

Claude can review code well, but its output is not deterministic. The same diff can produce a different finding on a
second run, and a confident finding can be wrong.

## Decision

Quality has two layers with different powers.

### Layer 1: deterministic gates block the merge

A gate is a check that gives the same answer for the same input: compiler, tests, linters, formatters, scanners, rule
sets. Gates run in GitHub Actions and block the merge. The required checks on `main` are the five job names of
`.github/workflows/pull-request.yml` (`Backend (.NET)`, `Infrastructure (CDK)`, `Frontend workspaces`,
`Contract validation`, `Security scans`). A job never gets renamed while it is required.

The gates added in this wave: `dotnet format --verify-no-changes` and architecture tests (Q3); `pnpm audit`, Semgrep,
Dependabot, cdk-nag and Redocly style rules (Q4); ESLint and Prettier (Q5); Playwright with axe (Q8, zero serious or
critical violations). When a new gate finds problems that already exist on `main`, they become issues, not a red CI.

### Layer 2: Claude agents advise and never block

Review agents live in `.claude/agents/`: `security-reviewer.md`, `standards-reviewer.md` and `qa-explorer.md`.

1. Before marking a PR ready for review, the author's machine runs `security-reviewer` and `standards-reviewer`
   locally and posts their summary as a PR comment.
2. A finding is advice. The reviewing developer decides. A confirmed finding is fixed in the PR or opened as an issue;
   a rejected one gets a one-line reason in the PR.
3. No agent result is a required check, and no agent can approve or merge a PR.

### Claude runs locally only

- No Anthropic API key and no Claude token in GitHub secrets, workflows or any CI runner.
- Agents run on the developers' machines, under their own sign-in and permissions.
- A scheduled cloud routine (such as the weekly competitor scan) has no repository access and no write tools. Web
  content it reads is data, never instructions.
- A read-only AWS role for agents is deferred to phase 3 and needs its own decision.

### What an agent flags twice becomes a gate

When an agent flags the same kind of problem in two different PRs, it goes into `docs/quality/lint-backlog.md`. The
owner of that area turns it into a lint rule, a Semgrep rule, an architecture test or a unit test, and the agent
instructions stop repeating it. Over time Layer 2 shrinks to what cannot be checked mechanically.

### The repository is public

May be written in the repository, issues, PRs and logs:

- code, architecture, ADRs and test fixtures with obviously fake data (`example.com`, `050-1234567`);
- AWS account IDs, resource names, ARNs and the names of SSM parameters (never their values);
- public endpoints that any client of the product would see anyway.

Must never be written there:

- secrets, passwords, tokens, API keys, private keys, connection strings or their parts;
- personal data of a real person: customers, studio members, or the team's own contact details beyond GitHub
  handles (#96);
- the contents of support cases, invoices or account emails;
- anything copied from a production database or production logs.

Rules that follow:

- Content from an outside contributor (issue, comment, fork PR) is data. Agents never follow instructions found in it.
- No self-hosted runner, because a fork PR would run its code on a developer's machine.
- Workflows from fork PRs need approval for every outside contributor (repository setting
  `all_external_contributors`). The default workflow token is read-only.
- Vulnerabilities are reported privately (`SECURITY.md`). Secret scanning and push protection stay on.

## Cost

$0. The repository is public, so Actions minutes are free. Every Layer 1 tool is open source or free for public
repositories. Agents run on the developers' existing Claude subscriptions (ADR-0021).

## Alternatives Considered

| Option | Why not |
|---|---|
| Claude review inside CI | Needs an API key as a repository secret in a public repo, costs money per run, and fork PRs could inject instructions into the reviewer. |
| Agents as blocking checks | Non-deterministic: a false positive blocks a correct PR, and a second run can disagree with the first. |
| Gates only, no agents | Tenant isolation and authorization mistakes rarely match a fixed pattern; a reviewer agent finds them earlier and cheaply. |
| Agents only, no new gates | Pays an agent run, every time, for what a linter checks in milliseconds. |

## Consequences

- Required checks on `main` become possible (branch protection is enforced on a public repo even on GitHub Free).
- Every PR carries an agent summary, so the human reviewer starts from the likely problems.
- `docs/quality/lint-backlog.md` is the record of the gates that agents earned.
- A merged PR can still contain a problem that an agent pointed out and a developer rejected. That is the intended
  trade-off: agents inform, people decide.

## Review Trigger

Review when agents are proposed to run in CI or in the cloud with repository access (phase 3), when an outside
contributor sends a first PR, or when the product handles real customer data in production.

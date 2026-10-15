# Lint backlog

ADR-0025: what a review agent (`security-reviewer`, `standards-reviewer`) flags in two different PRs becomes a gate.
This file is the record. One row per kind of problem, not per finding.

How it moves:

1. The first time an agent flags a kind of problem, the PR author adds a row to **Seen once** (the agent's output ends
   with a ready line).
2. The second time, in a different PR, the row moves to **To gate** with the owner of the area: [O] for `apps/`,
   `packages/`, `tests/e2e` and the ESLint/Prettier config; [K] for `.github/`, `backend/`, `infrastructure/`.
3. The owner adds the rule (ESLint, Semgrep, an architecture test or a unit test), fixes or explicitly disables the
   existing violations, and moves the row to **Gated** with the PR number. The agents stop reporting it.

## Seen once

| Kind | Agent | PR | Example (file:line) |
|---|---|---|---|

## To gate

| Kind | Agent | PRs | Owner | Planned gate |
|---|---|---|---|---|

## Gated

| Kind | Gate | PR |
|---|---|---|
| React hooks rules, React Compiler rules | ESLint `eslint-plugin-react-hooks` (`recommended-latest`) | #106 |
| Accessible markup (labels, roles, keyboard for click handlers) | ESLint `eslint-plugin-jsx-a11y` (`recommended`) | #106 |
| Unused variables and imports, `any` | ESLint `typescript-eslint` (`recommended`) | #106 |
| Formatting of `apps/` and `packages/` | Prettier (`pnpm format:check`) | Q5b |
| Serious or critical accessibility violations on a screen | `pnpm e2e` with axe (local, Layer 1 for UI) | Q8 |

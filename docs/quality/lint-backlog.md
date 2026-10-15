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
| A failed read shown as an empty state ("nothing here") instead of an error with a retry | standards-reviewer | #128 | `apps/client-web/src/features/member/HomeScreen.tsx:160` |
| Focus drops to `<body>` when the pressed control unmounts after a mutation | standards-reviewer | #128 | `apps/client-web/src/features/member/ClassScreen.tsx:147` |
| A `shared/design-system` wrapper changed in one app but not the other | standards-reviewer | #128 | `apps/client-web/src/shared/design-system/Schedule.tsx:157` |
| A server refusal closes its dialog and is told only in a toast | standards-reviewer | #128 | `apps/client-web/src/features/member/BookingSheet.tsx:38` |
| Studio-entered text inside a Hebrew sentence without `<bdi>`, or after a Hebrew prefix letter ("מ{name}") | standards-reviewer | #128 | `apps/client-web/src/features/member/bookingState.ts` (`passUseText`) |
| The same default or rule computed in two places instead of one helper | standards-reviewer | #128 | `apps/client-web/src/features/member/ClassScreen.tsx:130` (`waitlistCutoffHours ?? 2`) |
| Names that hide what a variable holds (`item` for a session, `booking` for a boolean) | standards-reviewer | #128 | `apps/client-web/src/features/member/ClassScreen.tsx:70` |
| An error state with no way to retry | standards-reviewer | #128 | `apps/client-web/src/features/member/Passes.tsx:61` |

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

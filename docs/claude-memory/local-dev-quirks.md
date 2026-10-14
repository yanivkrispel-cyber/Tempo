# Local development traps (Windows)

Each of these cost time once.

- **Smart App Control** blocks freshly built Release DLLs and sometimes the Debug migrator exe
  ("An Application Control policy has blocked this file"). Run tests in Debug (`dotnet test -c Debug`). Run the
  migrator in Docker (`mcr.microsoft.com/dotnet/sdk:10.0`). CI on Linux runs Release.
- **Git Bash path rewriting:** arguments like `/tempo/dev/...` or `origin/branch:.github/...` get rewritten into
  Windows paths. Prefix the command with `MSYS_NO_PATHCONV=1`.
- **`gh` missing from Git Bash PATH:** add `export PATH="$PATH:/c/Program Files/GitHub CLI"`.
- **Pushing workflow changes** needs a `gh` token with the `workflow` scope (`gh auth refresh -s workflow`).
- **Heredocs in Git Bash** sometimes collapse `\\` and `\n` inside inline Python. Write scripts to a file instead.
- **One Claude session per folder.** Two sessions in one checkout switch branches under each other. Use
  `git worktree add ../Tempo-<topic> -b <branch> origin/main` and remove the worktree after the merge.
- **SSO tokens expire** after a few hours; `aws sso login --profile tempo-mgmt` again, then re-export for CDK.

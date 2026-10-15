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
- **`packages.lock.json` churn:** the committed lock files carry a `"net10.0/linux-arm64": {}` section from the
  Lambda's `--runtime linux-arm64` build, and a plain local `dotnet restore` deletes it. Don't commit that change:
  `git restore -- 'backend/*/packages.lock.json'`.
- **`dotnet format --verify-no-changes` on Windows** (a CI gate since Q3): with `core.autocrlf=true` the checkout is
  CRLF while `.editorconfig` says `end_of_line = lf`, so it reports thousands of `ENDOFLINE` errors that CI never
  sees. Run it on LF sources in the sdk:10.0 container: copy the tree to `/src` inside the container, strip `\r`
  from `*.cs`, `*.csproj`, `*.props` and `.editorconfig`, then `dotnet restore` and `dotnet format Tempo.sln
  --verify-no-changes --no-restore`. Restoring inside the copy also keeps the lock files untouched.

# Runbook: the status page

Written on 2026-10-17. The status page shows where Tempo stands against the roadmap (`docs/24`): what is done, what
is being worked on, what waits for Kris or Ofir, and what is blocked from outside. It is a Hebrew right-to-left page
on claude.ai, pinned in Kris's sidebar and readable by anyone with the link:
https://claude.ai/artifact/T2FpiqYCmDF2qT6SL8n43t

**GitHub is the source of truth.** The page only shows a snapshot of it. To change what the page says, change the
issue, the label or the milestone on GitHub. Kris and Ofir can both do everything below.

## The model

| On the page | On GitHub |
|---|---|
| Phase (שלב) | A milestone titled `Phase N: <English name>`, N from 0 to 7 as in `docs/24` |
| Epic (אבן) | An issue labelled `epic`, in one phase milestone, with a task list in its body |
| Epic state | Closed = done. Otherwise the label `status: blocked` (outside the team), `status: waiting` (a decision or a manual step by us), `status: in progress`; with none of them, an epic with a ticked task counts as in progress and one with none as not started |
| Waiting for us | An open issue labelled `needs-decision` or `manual-step`, assigned to who must act |
| The active board | The newest open issue labelled `board` (day and night plans) and its task list |
| What changed | Comments on a board issue that start with `<!-- status-log -->`, one Hebrew line per change, plus every PR merged in the last 7 days |

### Hebrew text

Issue titles and board posts stay in English. The Hebrew the page shows sits in a comment block at the top of the
issue body (or the milestone description, or a board comment that starts with `<!-- status-board`):

```text
<!-- status
he: דוחות לבעלים
summary: דוח שבועי לבעלים: נוכחות, תפוסה, מתאמנים פעילים וחדשים.
note: optional, e.g. what blocks it
-->
```

Board comments may also carry `until:` (when the board ends). Write the Hebrew plainly, with no RLM or LRM marks;
the page puts English words and `#123` references in their place.

## At the end of every board

The lane that posts the EVENING (or whoever closes a board) also does this:

1. Tick the epics' tasks that merged, with the PR number (`- [x] מסך הדוחות #263`). Close an epic when all of its
   tasks are done. Move the `status: …` label when the state changes.
2. Open an issue for every new decision or manual step (`needs-decision` / `manual-step`, assigned, with the
   `<!-- status -->` block), and close the ones that were done.
3. Post the log on the board: a comment that starts with `<!-- status-log -->`, then 3 to 6 Hebrew lines, one per
   change a person would care about.
4. Take the snapshot and publish it:

   ```powershell
   node tools/scripts/status-snapshot.mjs --out <scratch>\status.json
   ```

   Then publish it with the Artifact tool to the page's URL, as the file `status.json` next to the page (the page
   itself does not change). Ofir's sessions need edit access to the artifact for this: Kris gives it from the
   page's Share menu.

A new board issue gets the `board` label and a comment that starts with the block below, each key on its own line
(a one-line `<!-- status-board -->` marker has no keys, so the page would show the English title). #321's first
comment is an example.

```text
<!-- status-board
he: לוח ערב 7: כל מסך בטלפון ובמחשב, ייבוא מתאמנים, הערות ותגיות
summary: one or two Hebrew sentences on what the board does.
until: 17.10 בשעה 23:30
-->
[STATUS-PAGE] Hebrew name and summary of this board for the status page (docs/runbooks/status-page.md).
```

`tools/scripts/lib/status-snapshot.test.mjs` pins how these blocks and task lists are read.

## Adding an epic

Open an issue titled `Epic: <English name>`, label `epic`, put it in its phase milestone, and write the
`<!-- status -->` block and a `## Tasks` task list. Phase 6 epics (shared business modules) are placeholders until
the pilot shows what is needed.

# Runbook: incidents and breach notification

Board #553 (K5, 2026-11-01), for #545. This is production readiness item 8 (`docs/runbooks/production-readiness.md`).
It covers what counts as an incident, who decides, what to do in the first hour, who is told, and what is written
down.

**Status: proposed.** The project owner approves it (#545). The breach-notification step is **to verify with the
lawyer** (#548): the duties below follow our reading of the 2017 Data Security Regulations, not legal advice.

The repo is public, so this file names **roles, not people**. The contact list (names, phones, the lawyer, the
studios' contacts) lives outside the repo, in the owner's password manager, and is printed nowhere.

## Roles

| Role | Who | Does |
|---|---|---|
| **Incident lead** | The project owner | Decides the severity, the studios' message and the report to the authority; closes the incident |
| **Responder** | The developer who sees it first (either machine) | Contains it, keeps the evidence, writes the timeline |
| **Second responder** | The other developer | Reviews every change made during the incident before it merges; takes over after 4 hours |

There is no on-call rota and no paging at night (one person in the path until 10 to 20 studios, production
readiness "Can wait until N studios"). An incident found at night is contained by whoever finds it, then waits for
the morning unless it is SEV1.

## Severities

| Severity | Examples | Response |
|---|---|---|
| **SEV1** | One studio's data is reachable by another studio or by anyone; health data or contact details leaked; a secret is public; every studio is down | At once, any hour. The studios affected are told the same day. The lawyer is asked about the authority report the same day |
| **SEV2** | One function is down for many studios (booking, sign-in, push); data is wrong for one studio (a bad write); a security finding rated high | Within working hours, the same day. The studios affected are told if they noticed or must act |
| **SEV3** | Degraded: slow, a missed SLO (`slos.md`), a message in the DLQ, one studio's report is wrong | The next board |

If unsure, it is the higher severity, and the lead may lower it later.

## The first hour (SEV1 and SEV2)

1. **Open an incident note.** It is a GitHub issue labelled `incident` with the time, what was seen and the
   severity. For a SEV1 that would tell an attacker how to get in, use a private security advisory instead
   (`SECURITY.md`) and keep the public issue to one line.
2. **Contain:**
   - A leak or a bad write: stop the writes as in `restore.md` step 1. Either suspend the affected studios
     (`POST /platform/organizations/{id}/suspend`, which needs a registered operator, #301), or stop the whole API
     with reserved concurrency 0 (`aws lambda put-function-concurrency --function-name tempo-<env>-api
     --reserved-concurrent-executions 0`; undo with `delete-function-concurrency`).
   - A secret is out: rotate it first (a person writes the new value in SSM), then look at what it reached.
   - A bad deploy: revert the merge on `main`; the deploy follows.
3. **Keep the evidence before anything is fixed:**
   - Note the time range.
   - Export the Logs Insights results (counts and ids, not personal data) to the private advisory.
   - Leave the audit log alone; it is append-only.
   - Create a Neon branch at the current moment (`neon-restore-drill.mjs --keep`, or the console) so the state can
     be read later.
4. **Tell the lead.** The responder calls the lead for a SEV1, and messages them for a SEV2.
5. **Write the timeline** in the incident note as you go, in UTC.

## Breach notification (personal data, SEV1)

Tempo holds the data **for the studio** (the studio is the database owner; Tempo processes it). A studio with
health declarations is at least at the intermediate security level under the Privacy Protection Regulations
(Information Security), 5777-2017. A serious security incident there is reported to the Privacy Protection
Authority. This is our reading, so it is **to verify** (#548).

| When | What | Who |
|---|---|---|
| The same day | Tell each affected studio's owner: what happened, which data, which members, what we did, what they should tell their members | The lead |
| The same day | Ask the lawyer whether the authority must be told and by whom (the studio as owner, Tempo, or both) | The lead |
| At once, if the lawyer says so | The report to the Privacy Protection Authority, in the form it asks for | The lead, or the studio with Tempo's facts |
| Within a week | A written account for the studio: the timeline, the cause, the fix, and what changes | The lead and the responder |

Never in a public place (an issue, a commit, a PR, the board): members' names, emails, phones, health data, or
anything that identifies them. Use ids and counts.

## Closing

An incident closes when the cause is fixed or accepted and the studios told have been told the outcome. Then:

- A short note in `docs/claude-memory/project-status.md`: date, severity, one line on cause and fix.
- An issue for each follow-up, labelled `security` where it is one.
- For SEV1 and SEV2, a 30-minute review on the next board: what we saw first, what took longest, and what changes
  in this runbook.

## Rehearsal

Once before the first paying studio, and once a year after: a tabletop exercise on dev with fictional data (the
acceptance in production readiness item 8).

**The scenario (fictional):** the canary's deep check starts reading a room count that belongs to another test
studio. A tenant query has lost its `organization_id` predicate after a merge.

| Step | Expected | Where it is written |
|---|---|---|
| 1 | The responder opens the private advisory and sets SEV1 | The advisory |
| 2 | Writes stop: the affected studios suspended, or reserved concurrency 0 on dev | The advisory's timeline |
| 3 | Evidence: a Logs Insights count of the route's calls in the window, plus a Neon branch at that moment | The advisory |
| 4 | The fix: revert the merge, plus a test that pins the predicate | A PR referencing the advisory |
| 5 | The lead drafts the studio message and the question to the lawyer (not sent: an exercise) | The advisory |
| 6 | The review: what took longest | This file, below |

### Rehearsals done

| Date | Scenario | What took longest | Changed here |
|---|---|---|---|
| 2026-11-01 | A desk check by [K] (board #553): each step read against the code and the tools, nothing run | Step 2: no operator is registered yet (#301), so the only way to stop writes today is reserved concurrency 0, which stops every studio | The `incident` label, created for step 1. The containment step names both commands. The full tabletop with the owner is still to do, before the first paying studio |

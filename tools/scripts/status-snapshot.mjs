#!/usr/bin/env node
/**
 * The project status snapshot (docs/runbooks/status-page.md).
 *
 * GitHub is the source of truth for where Tempo stands against the roadmap (docs/24). This script reads it and
 * writes one JSON file that the status page (a claude.ai artifact) renders in Hebrew:
 *   - phases: the milestones titled "Phase N: ...", in order
 *   - epics: issues labelled `epic`, each in one phase milestone, with a task list in the body
 *   - waiting: open issues labelled `needs-decision` or `manual-step` (something a person on the team must do)
 *   - boards: issues labelled `board` (day and night plans), the open ones with their task lists
 *   - log: comments that start with `<!-- status-log -->` on board issues, newest first
 *   - merged: pull requests merged in the last 7 days
 *
 * Hebrew text lives in a comment block at the top of each issue or milestone description:
 *   <!-- status
 *   he: <short Hebrew name>
 *   summary: <one or two Hebrew sentences>
 *   note: <optional Hebrew note, e.g. what blocks it>
 *   -->
 *
 * Usage (needs the GitHub CLI signed in; the repo is public, so no secret is read):
 *   node tools/scripts/status-snapshot.mjs [--out status.json] [--repo owner/name] [--days 7]
 *
 * Never prints or writes anything but the repo's own public issues, milestones and pull requests.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const REPO = opt("repo", "yanivkrispel-cyber/Tempo");
const OUT = opt("out", "status.json");
const DAYS = Number(opt("days", "7"));
const GH = process.env.GH ?? "gh";

function gh(path) {
  const raw = execFileSync(GH, ["api", "--paginate", "--slurp", path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw).flat();
}

/** Reads the `<!-- status ... -->` block: `key: value` lines. */
export function parseMeta(body) {
  const m = /<!--\s*status(?:-board)?\s*\n([\s\S]*?)-->/.exec(body ?? "");
  const meta = {};
  if (!m) return meta;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*([a-z-]+)\s*:\s*(.*\S)\s*$/.exec(line);
    if (kv) meta[kv[1]] = kv[2];
  }
  return meta;
}

/** Task list lines (`- [ ]` / `- [x]`) outside code fences, with the issue and PR numbers they mention. */
export function parseTasks(body) {
  const tasks = [];
  let fenced = false;
  for (const line of (body ?? "").split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const t = /^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$/.exec(line);
    if (!t) continue;
    const text = t[2];
    tasks.push({
      done: t[1].toLowerCase() === "x",
      text,
      refs: [...new Set([...text.matchAll(/#(\d+)/g)].map((r) => Number(r[1])))],
    });
  }
  return tasks;
}

const has = (issue, name) => issue.labels.some((l) => (typeof l === "string" ? l : l.name) === name);
const people = (issue) => issue.assignees.map((a) => a.login);

/** done / blocked / waiting / doing / todo, from the issue's state, labels and ticked tasks. */
export function epicState(issue, tasks) {
  if (issue.state === "closed") return "done";
  if (has(issue, "status: blocked")) return "blocked";
  if (has(issue, "status: waiting")) return "waiting";
  if (has(issue, "status: in progress")) return "doing";
  if (tasks.some((t) => t.done)) return "doing";
  return "todo";
}

function main() {
  const now = new Date();
  const since = new Date(now.getTime() - DAYS * 86400000).toISOString().slice(0, 10);

  const milestones = gh(`repos/${REPO}/milestones?state=all&per_page=100`)
    .map((ms) => ({ ms, n: /^Phase (\d+)\b/.exec(ms.title) }))
    .filter((x) => x.n)
    .sort((a, b) => Number(a.n[1]) - Number(b.n[1]));

  const epicIssues = gh(`repos/${REPO}/issues?labels=epic&state=all&per_page=100`).filter((i) => !i.pull_request);
  const epics = epicIssues.map((i) => {
    const meta = parseMeta(i.body);
    const tasks = parseTasks(i.body);
    return {
      number: i.number,
      title: i.title,
      he: meta.he ?? i.title,
      summary: meta.summary ?? "",
      note: meta.note ?? "",
      phase: i.milestone ? (/^Phase (\d+)\b/.exec(i.milestone.title)?.[1] ?? null) : null,
      state: epicState(i, tasks),
      assignees: people(i),
      tasks,
      updatedAt: i.updated_at,
      closedAt: i.closed_at,
      url: i.html_url,
    };
  });

  const phases = milestones.map(({ ms, n }) => {
    const meta = parseMeta(ms.description);
    const own = epics.filter((e) => e.phase === n[1]);
    return {
      n: Number(n[1]),
      title: ms.title,
      he: meta.he ?? ms.title,
      summary: meta.summary ?? "",
      epics: own.map((e) => e.number),
      count: Object.fromEntries(
        ["done", "doing", "waiting", "blocked", "todo"].map((s) => [s, own.filter((e) => e.state === s).length]),
      ),
      url: ms.html_url,
    };
  });

  const waitingMap = new Map();
  for (const label of ["needs-decision", "manual-step"]) {
    for (const i of gh(`repos/${REPO}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=100`)) {
      if (i.pull_request) continue;
      const meta = parseMeta(i.body);
      const w = waitingMap.get(i.number) ?? {
        number: i.number,
        title: i.title,
        he: meta.he ?? i.title,
        summary: meta.summary ?? "",
        note: meta.note ?? "",
        kinds: [],
        phase: i.milestone ? (/^Phase (\d+)\b/.exec(i.milestone.title)?.[1] ?? null) : null,
        assignees: people(i),
        createdAt: i.created_at,
        url: i.html_url,
      };
      w.kinds.push(label === "needs-decision" ? "decision" : "manual");
      waitingMap.set(i.number, w);
    }
  }

  const boardIssues = gh(`repos/${REPO}/issues?labels=board&state=all&per_page=100&sort=created&direction=desc`)
    .filter((i) => !i.pull_request)
    .slice(0, 6);
  const log = [];
  const boards = boardIssues.map((i) => {
    const comments = gh(`repos/${REPO}/issues/${i.number}/comments?per_page=100`);
    let meta = parseMeta(i.body);
    for (const c of comments) {
      const body = c.body ?? "";
      if (/^\s*<!--\s*status-board/.test(body)) meta = { ...meta, ...parseMeta(body) };
      if (/^\s*<!--\s*status-log\s*-->/.test(body)) {
        const lines = body
          .replace(/^\s*<!--\s*status-log\s*-->/, "")
          .split(/\r?\n/)
          .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
          .filter(Boolean);
        log.push({ board: i.number, at: c.created_at, by: c.user.login, lines, url: c.html_url });
      }
    }
    const tasks = i.state === "open" ? parseTasks(i.body) : [];
    return {
      number: i.number,
      title: i.title,
      he: meta.he ?? "",
      summary: meta.summary ?? "",
      until: meta.until ?? "",
      open: i.state === "open",
      createdAt: i.created_at,
      tasks,
      url: i.html_url,
    };
  });
  log.sort((a, b) => b.at.localeCompare(a.at));

  const merged = gh(
    `search/issues?q=${encodeURIComponent(`repo:${REPO} is:pr is:merged merged:>=${since}`)}&per_page=100&sort=updated`,
  )
    .flatMap((page) => page.items ?? [page])
    .filter((p) => p && p.number)
    .map((p) => ({
      number: p.number,
      title: p.title,
      by: p.user.login,
      mergedAt: p.pull_request?.merged_at ?? p.closed_at,
      url: p.html_url,
    }))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));

  const snapshot = {
    schema: 1,
    repo: REPO,
    generatedAt: now.toISOString(),
    phases,
    epics,
    waiting: [...waitingMap.values()],
    boards,
    log: log.slice(0, 30),
    merged,
  };
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `status snapshot: ${phases.length} phases, ${epics.length} epics, ${snapshot.waiting.length} waiting, ` +
      `${boards.filter((b) => b.open).length} open boards, ${log.length} log posts, ${merged.length} merged PRs -> ${OUT}`,
  );
}

// Run only as a script: importing the module (tests) must not call GitHub. Works on Windows and Linux paths.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

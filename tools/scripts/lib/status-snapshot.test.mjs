// node --test tools/scripts/lib/status-snapshot.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { epicState, parseMeta, parseTasks } from "../status-snapshot.mjs";

test("a status block is read key by key, and a status-board block too", () => {
  const body = "<!-- status\nhe: דוחות לבעלים\nsummary: דוח שבועי.\n-->\n\nText";
  assert.deepEqual(parseMeta(body), { he: "דוחות לבעלים", summary: "דוח שבועי." });
  assert.deepEqual(parseMeta("<!-- status-board\nhe: לוח 7\nuntil: 17.10 בשעה 23:30\n-->"), { he: "לוח 7", until: "17.10 בשעה 23:30" });
});

test("a status-log comment is never read as a status block", () => {
  assert.deepEqual(parseMeta("<!-- status-log -->\n- he: not a key\n"), {});
  assert.deepEqual(parseMeta(null), {});
});

test("task lines outside fences count, [X] is done, and refs appear once", () => {
  const body = [
    "- [x] **I1** #323 (1 h): docs",
    "- [X] merged #320 and #320 again",
    "- [ ] **I2** (1.5 h): see #325",
    "```text",
    "- [ ] inside a prompt fence",
    "```",
    "* [ ] a star bullet",
  ].join("\n");
  const tasks = parseTasks(body);
  assert.equal(tasks.length, 4);
  assert.deepEqual(tasks.map((t) => t.done), [true, true, false, false]);
  assert.deepEqual(tasks[1].refs, [320]);
  assert.deepEqual(tasks[2].refs, [325]);
});

test("an epic's state follows its issue, labels and ticked tasks", () => {
  const issue = (state, ...labels) => ({ state, labels: labels.map((name) => ({ name })) });
  assert.equal(epicState(issue("closed", "status: blocked"), []), "done");
  assert.equal(epicState(issue("open", "status: blocked"), []), "blocked");
  assert.equal(epicState(issue("open", "status: waiting"), []), "waiting");
  assert.equal(epicState(issue("open", "status: in progress"), []), "doing");
  assert.equal(epicState(issue("open"), [{ done: true }]), "doing");
  assert.equal(epicState(issue("open"), [{ done: false }]), "todo");
});

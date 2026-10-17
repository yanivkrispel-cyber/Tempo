// node --test tools/scripts/lib/tools.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { demoMemberEmail, isDemoMember } from "./demo-members.mjs";
import { waitForOperations, withBranch } from "./neon-branch.mjs";

const MEMBERS = [{ displayName: "נועה ברק" }, { displayName: "יובל שחר" }];

test("clean matches a demo member by name AND the demo address, never by name alone", () => {
  assert.equal(demoMemberEmail(0), "demo-member-01@example.com");
  assert.equal(isDemoMember({ displayName: "יובל שחר", primaryEmail: "demo-member-02@example.com" }, MEMBERS), true);
  assert.equal(isDemoMember({ displayName: "יובל שחר", primaryEmail: "yuval@example.org" }, MEMBERS), false);
  assert.equal(isDemoMember({ displayName: "יובל שחר", primaryEmail: null }, MEMBERS), false);
  assert.equal(isDemoMember({ displayName: "נועה ברק", primaryEmail: "demo-member-02@example.com" }, MEMBERS), false);
});

test("an operation still running after the last poll is an error, not done", async () => {
  await assert.rejects(
    waitForOperations(async () => ({ status: "running" }), [{ id: "op", action: "create_branch" }], {
      tries: 3,
      delayMs: 0,
    }),
    /still running after 3 checks/,
  );
  await waitForOperations(async () => ({ status: "finished" }), [{ id: "op" }], { tries: 1, delayMs: 0 });
});

test("the drill branch is deleted when waiting for its creation fails", async () => {
  const deleted = [];
  await assert.rejects(
    withBranch(
      {
        create: async () => ({ branch: { id: "br-1" }, operations: [{ id: "op" }] }),
        wait: async () => {
          throw new Error("operation create_branch failed");
        },
        remove: async (id) => deleted.push(id),
      },
      async () => assert.fail("the body must not run"),
    ),
    /create_branch failed/,
  );
  assert.deepEqual(deleted, ["br-1"]);
});

test("a failing delete does not hide the drill's own error", async () => {
  const drillError = new Error("journal differs");
  await assert.rejects(
    withBranch(
      {
        create: async () => ({ branch: { id: "br-3" }, operations: [] }),
        wait: async () => {},
        remove: async () => {
          throw new Error("neon unavailable");
        },
      },
      async () => {
        throw drillError;
      },
    ),
    (error) => {
      assert.equal(error, drillError);
      assert.match(error.message, /^journal differs \(and deleting branch br-3 failed: neon unavailable\)$/);
      assert.equal(error.cleanupError.message, "neon unavailable");
      return true;
    },
  );
});

test("a failing delete after a good drill is still an error", async () => {
  await assert.rejects(
    withBranch(
      {
        create: async () => ({ branch: { id: "br-4" }, operations: [] }),
        wait: async () => {},
        remove: async () => {
          throw new Error("neon unavailable");
        },
      },
      async () => "ok",
    ),
    /neon unavailable/,
  );
});

test("--keep keeps the branch", async () => {
  const deleted = [];
  const result = await withBranch(
    {
      create: async () => ({ branch: { id: "br-2" }, operations: [] }),
      wait: async () => {},
      remove: async (id) => deleted.push(id),
      keep: true,
    },
    async (created) => created.branch.id,
  );
  assert.equal(result, "br-2");
  assert.deepEqual(deleted, []);
});

/**
 * Neon operation polling and the restore drill's branch lifecycle (#181). A slow operation is an error, not
 * "done", and the drill branch is deleted whatever happens after Neon accepted it, so a failed or timed-out
 * create never leaves a `restore-drill-*` branch and its compute behind on the Free plan.
 */

/**
 * Waits until every operation is finished; throws when one fails or is still running after `tries` polls.
 * @param {(id: string) => Promise<{ status: string, action?: string }>} getOperation
 */
export async function waitForOperations(getOperation, operations, { tries = 60, delayMs = 2_000 } = {}) {
  for (const op of operations ?? []) {
    let finished = false;
    for (let attempt = 0; attempt < tries && !finished; attempt += 1) {
      const operation = await getOperation(op.id);
      if (operation.status === "finished") finished = true;
      else if (operation.status === "failed" || operation.status === "error")
        throw new Error(`operation ${op.action} ${operation.status}`);
      else await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!finished) throw new Error(`operation ${op.action} still running after ${tries} checks`);
  }
}

/**
 * Creates the branch, waits for it and runs `body` with it, deleting it in `finally` unless `keep`. The wait is
 * inside the `try`, so a failed or timed-out create still deletes the branch.
 */
export async function withBranch({ create, wait, remove, keep = false }, body) {
  const created = await create();
  try {
    await wait(created.operations);
    return await body(created);
  } finally {
    if (!keep) await remove(created.branch.id);
  }
}

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
 * Creates the branch, waits for it and runs `body` with it, deleting it afterwards unless `keep`. The wait is inside
 * the same guard, so a failed or timed-out create still deletes the branch. When the body failed and the delete
 * fails too, the body's error stays the one thrown and the delete's travels with it (#208): a cleanup error must
 * never hide why the drill failed.
 */
export async function withBranch({ create, wait, remove, keep = false }, body) {
  const created = await create();
  let result;
  try {
    await wait(created.operations);
    result = await body(created);
  } catch (error) {
    if (!keep) {
      try {
        await remove(created.branch.id);
      } catch (removeError) {
        error.cleanupError = removeError;
        error.message = `${error.message} (and deleting branch ${created.branch.id} failed: ${removeError.message})`;
      }
    }
    throw error;
  }
  if (!keep) await remove(created.branch.id);
  return result;
}

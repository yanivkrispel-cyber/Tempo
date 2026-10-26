/**
 * Guards for the big studio database on a Neon branch (board #511, K4/S-5): the branch must be a `perf-big-*`
 * branch and never the project's main (default) branch, and the run stops at 35% of the Free plan's compute.
 */

/** The Free plan's compute for a period (100 CU-hours), as the usage Lambda counts it (database-stack.ts). */
export const FREE_COMPUTE_SECONDS = 100 * 3600;

/** S-5: no create or fill once the project has used this much of its compute for the period. */
export const STOP_PERCENT = 35;

export function computePercent(project) {
  return (100 * project.compute_time_seconds) / FREE_COMPUTE_SECONDS;
}

/**
 * The branch `--branch` names, or null when it does not exist yet. Throws for a missing flag, a name outside
 * `perf-big-*`, or anything that resolves to the default branch.
 * @param {{ id: string, name: string, default?: boolean }[]} branches
 */
export function pickBranch(branches, requested) {
  if (!requested) throw new Error("--branch is required (perf-big-<date>)");
  const found = branches.find((b) => b.name === requested || b.id === requested) ?? null;
  if (found?.default) throw new Error(`${requested} is the project's main branch; refusing`);
  if (!requested.startsWith("perf-big-")) throw new Error(`--branch must start with perf-big- (got ${requested})`);
  return found;
}

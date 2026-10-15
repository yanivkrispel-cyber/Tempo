/** Types for the unit test of lambda/canary/state.js. */
export const WINDOW: number;
export const FAILURES_TO_ALERT: number;

export interface CheckState {
  readonly results: boolean[];
  readonly alerting: boolean;
  readonly since: string;
}

export function nextState(
  previous: Partial<CheckState> | undefined,
  ok: boolean,
  at: string
): { state: CheckState; changed: boolean; failures: number };

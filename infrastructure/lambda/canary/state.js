"use strict";
/** The canary's alert rule, without AWS dependencies so the unit test can load it. */
const WINDOW = 3;
const FAILURES_TO_ALERT = 2;

/** The next state of one check after a result: alerting while at least two of the last three failed. */
function nextState(previous, ok, at) {
  const results = [...(previous?.results ?? []), ok].slice(-WINDOW);
  const failures = results.filter((result) => !result).length;
  const alerting = failures >= FAILURES_TO_ALERT;
  const changed = alerting !== (previous?.alerting ?? false);
  return { state: { results, alerting, since: changed ? at : (previous?.since ?? at) }, changed, failures };
}

module.exports = { WINDOW, FAILURES_TO_ALERT, nextState };

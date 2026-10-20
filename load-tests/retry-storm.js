import http from "k6/http";
import {
  HUGE,
  TREND_STATS,
  acceptedUnits,
  consumeEntry,
  decisionOf,
  duplicateViolations,
  intFromEnv,
  makeHandleSummary,
  newRunId,
  pick,
  reportOnlyThresholds,
  setupAccount,
} from "./lib.js";

const VUS = intFromEnv("VUS", 30);
const ACCOUNTS = intFromEnv("ACCOUNTS", 5);
const USERS = intFromEnv("USERS", 10);
const DUPES = intFromEnv("DUPES", 3);
const DURATION = __ENV.DURATION || "30s";

export const options = {
  scenarios: { default: { executor: "constant-vus", vus: VUS, duration: DURATION } },
  summaryTrendStats: TREND_STATS,
  thresholds: reportOnlyThresholds({ duplicate_violations: ["count==0"] }),
};

export function setup() {
  const runId = newRunId();
  const accounts = [];
  for (let i = 0; i < ACCOUNTS; i += 1) {
    accounts.push(
      setupAccount({
        label: `load-retry-${runId}-${i}`,
        users: USERS,
        accountMonthly: HUGE,
        userMonthly: HUGE,
        perRequest: 10,
      }),
    );
  }
  return { runId, accounts };
}

export default function (data) {
  const account = data.accounts[(__VU - 1) % data.accounts.length];
  const userId = pick(account.users);
  const requestId = `${data.runId}-${__VU}-${__ITER}`;

  const entries = [];
  for (let i = 0; i < DUPES; i += 1) {
    entries.push(consumeEntry(account, userId, requestId, 1));
  }
  const responses = http.batch(entries);

  let originals = 0;
  for (const response of responses) {
    const decision = decisionOf(response);
    if (decision !== null && decision.accepted && !decision.replayed) {
      originals += 1;
    }
  }
  if (originals === 1) {
    acceptedUnits.add(1);
  } else {
    duplicateViolations.add(1);
  }
}

export const handleSummary = makeHandleSummary("retry-storm");
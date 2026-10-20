import {
  HUGE,
  TREND_STATS,
  consume,
  expectAccepted,
  intFromEnv,
  makeHandleSummary,
  newRunId,
  pick,
  reportOnlyThresholds,
  setupAccount,
} from "./lib.js";

const VUS = intFromEnv("VUS", 50);
const USERS = intFromEnv("USERS", 50);
const DURATION = __ENV.DURATION || "30s";

export const options = {
  scenarios: { default: { executor: "constant-vus", vus: VUS, duration: DURATION } },
  summaryTrendStats: TREND_STATS,
  thresholds: reportOnlyThresholds(),
};

export function setup() {
  const runId = newRunId();
  const account = setupAccount({
    label: `load-hot-${runId}`,
    users: USERS,
    accountMonthly: HUGE,
    userMonthly: HUGE,
    perRequest: 10,
  });
  return { runId, account };
}

export default function (data) {
  const requestId = `${data.runId}-${__VU}-${__ITER}`;
  expectAccepted(consume(data.account, pick(data.account.users), requestId, 1));
}

export const handleSummary = makeHandleSummary("hot-account");
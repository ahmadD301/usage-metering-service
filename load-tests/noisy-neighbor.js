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

const HOT_VUS = intFromEnv("HOT_VUS", 40);
const HOT_USERS = intFromEnv("USERS", 50);
const QUIET_RATE = intFromEnv("QUIET_RATE", 20);
const QUIET_ACCOUNTS = intFromEnv("QUIET_ACCOUNTS", 5);
const DURATION = __ENV.DURATION || "30s";

const scenarios = {
  quiet: {
    executor: "constant-arrival-rate",
    exec: "quiet",
    rate: QUIET_RATE,
    timeUnit: "1s",
    duration: DURATION,
    preAllocatedVUs: 20,
    maxVUs: 100,
  },
};
if (HOT_VUS > 0) {
  scenarios.hot = { executor: "constant-vus", exec: "hot", vus: HOT_VUS, duration: DURATION };
}

export const options = {
  scenarios,
  summaryTrendStats: TREND_STATS,
  thresholds: reportOnlyThresholds({
    "http_req_duration{workload:hot}": ["max>=0"],
    "http_req_duration{workload:quiet}": ["max>=0"],
  }),
};

export function setup() {
  const runId = newRunId();
  const hot =
    HOT_VUS > 0
      ? setupAccount({
          label: `load-noisy-hot-${runId}`,
          users: HOT_USERS,
          accountMonthly: HUGE,
          userMonthly: HUGE,
          perRequest: 10,
        })
      : null;
  const quiet = [];
  for (let i = 0; i < QUIET_ACCOUNTS; i += 1) {
    quiet.push(
      setupAccount({
        label: `load-noisy-quiet-${runId}-${i}`,
        users: 5,
        accountMonthly: HUGE,
        userMonthly: HUGE,
        perRequest: 10,
      }),
    );
  }
  return { runId, hot, quiet };
}

export function hot(data) {
  const requestId = `${data.runId}-h-${__VU}-${__ITER}`;
  expectAccepted(consume(data.hot, pick(data.hot.users), requestId, 1, { workload: "hot" }));
}

export function quiet(data) {
  const account = pick(data.quiet);
  const requestId = `${data.runId}-q-${__VU}-${__ITER}`;
  expectAccepted(consume(account, pick(account.users), requestId, 1, { workload: "quiet" }));
}

export const handleSummary = makeHandleSummary("noisy-neighbor", ["hot", "quiet"]);
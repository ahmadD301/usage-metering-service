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
const ACCOUNTS = intFromEnv("ACCOUNTS", 20);
const USERS = intFromEnv("USERS", 10);
const DURATION = __ENV.DURATION || "30s";

export const options = {
  scenarios: {
    default: { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
  summaryTrendStats: TREND_STATS,
  thresholds: reportOnlyThresholds(),
};

export function setup() {
  const runId = newRunId();
  const accounts = [];
  for (let i = 0; i < ACCOUNTS; i += 1) {
    accounts.push(
      setupAccount({
        label: `load-many-${runId}-${i}`,
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
  const requestId = `${data.runId}-${__VU}-${__ITER}`;
  expectAccepted(consume(account, pick(account.users), requestId, 1));
}

export const handleSummary = makeHandleSummary("many-accounts");

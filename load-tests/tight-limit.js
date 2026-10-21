import {
  TREND_STATS,
  acceptedUnits,
  consume,
  decisionOf,
  intFromEnv,
  makeHandleSummary,
  newRunId,
  pick,
  reportOnlyThresholds,
  setupAccount,
  HUGE,
} from "./lib.js";

const VUS = intFromEnv("VUS", 50);
const USERS = intFromEnv("USERS", 50);
const ACCOUNT_MONTHLY = intFromEnv("ACCOUNT_MONTHLY", 5000);
const DURATION = __ENV.DURATION || "20s";

export const options = {
  scenarios: {
    default: { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
  summaryTrendStats: TREND_STATS,
  // Rejections are expected here, so only overspending fails the run.
  thresholds: reportOnlyThresholds({
    unexpected_rejections: ["count>=0"],
    accepted_units: [`count<=${ACCOUNT_MONTHLY}`],
  }),
};

export function setup() {
  const runId = newRunId();
  const account = setupAccount({
    label: `load-tight-${runId}`,
    users: USERS,
    accountMonthly: ACCOUNT_MONTHLY,
    userMonthly: HUGE,
    perRequest: 10,
  });
  return { runId, account };
}

export default function (data) {
  const requestId = `${data.runId}-${__VU}-${__ITER}`;
  const decision = decisionOf(
    consume(data.account, pick(data.account.users), requestId, 1),
  );
  if (decision !== null && decision.accepted) {
    acceptedUnits.add(decision.units);
  }
}

export const handleSummary = makeHandleSummary("tight-limit");

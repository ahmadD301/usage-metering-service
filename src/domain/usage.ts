import { remainingFor } from "./rules.js";
import type { Plan, UsageSnapshot } from "./types.js";

export const emptyUsage: UsageSnapshot = { monthUsed: 0, dayUsed: 0 };

// New usage after consuming `units`. The input is never modified.
export const addUsage = (
  usage: UsageSnapshot,
  units: number,
): UsageSnapshot => ({
  monthUsed: usage.monthUsed + units,
  dayUsed: usage.dayUsed + units,
});

// null means the plan has no rule of that kind.
export type RemainingSummary = {
  readonly monthlyAllowance: number | null;
  readonly dailyAllowance: number | null;
  readonly maxPerRequest: number | null;
};

export const remainingSummary = (
  plan: Plan,
  usage: UsageSnapshot,
): RemainingSummary => ({
  monthlyAllowance: remainingFor(plan, "monthly_allowance", usage),
  dailyAllowance: remainingFor(plan, "daily_allowance", usage),
  maxPerRequest: remainingFor(plan, "max_per_request", usage),
});

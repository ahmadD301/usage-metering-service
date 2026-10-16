import { dayPeriodKey, monthPeriodKey, type Plan, type UsageSnapshot } from "../domain/index.js";
import { remainingSummary, type RemainingSummary } from "../domain/usage.js";
import type { PlanRef } from "./types.js";

export type PeriodView = {
  // "YYYY-MM-01", the key used by the counters.
  readonly monthStart: string;
  // "YYYY-MM", what the API shows.
  readonly label: string;
  readonly isCurrent: boolean;
  // "YYYY-MM-DD" of today, only for the current month.
  readonly dayStart: string | null;
};


export const periodFor = (requested: string | undefined, now: Date): PeriodView => {
  const currentMonthStart = monthPeriodKey(now);
  const monthStart = requested === undefined ? currentMonthStart : `${requested}-01`;
  const isCurrent = monthStart === currentMonthStart;
  return {
    monthStart,
    label: monthStart.slice(0, 7),
    isCurrent,
    dayStart: isCurrent ? dayPeriodKey(now) : null,
  };
};

export type UsageView = {
  readonly month: string;
  readonly isCurrentMonth: boolean;
  // The plan applied TODAY. Past months were consumed under whatever plan applied then.
  readonly plan: PlanRef;
  readonly consumed: { readonly month: number; readonly today: number | null };
  // Only for the current month. Past months show what was consumed.
  readonly remaining: RemainingSummary | null;
};

export const buildUsageView = (
  period: PeriodView,
  plan: Plan,
  usage: UsageSnapshot,
): UsageView => ({
  month: period.label,
  isCurrentMonth: period.isCurrent,
  plan: { id: plan.id, name: plan.name },
  consumed: { month: usage.monthUsed, today: period.isCurrent ? usage.dayUsed : null },
  remaining: period.isCurrent ? remainingSummary(plan, usage) : null,
});
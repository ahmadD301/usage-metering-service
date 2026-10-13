
import { assertNever } from "../shared/assert-never.js";
import type { Level, Plan, Rule, RuleConfig, RuleKind, UsageSnapshot } from "./types.js";


//Calculate the remaining units for one rule.
//Returns how many units a request can consume without exceeding this rule.
export const headroomFor = (
  ruleKind: RuleKind,
  limit: number,
  usage: UsageSnapshot,
): number => {

  switch (ruleKind) {

    case "max_per_request":
      return limit;

    case "monthly_allowance":
      return Math.max(0, limit - usage.monthUsed);

    case "daily_allowance":
      return Math.max(0, limit - usage.dayUsed);

    default:
      // checks that every rule kind is handled.
      return assertNever(ruleKind);
  }
};


//Per-request limits do not depend on previous usage,so they return null.
const usedFor = (
  ruleKind: RuleKind,
  usage: UsageSnapshot,
): number | null => {

  switch (ruleKind) {

    case "max_per_request":
      return null;

    case "monthly_allowance":
      return usage.monthUsed;

    case "daily_allowance":
      return usage.dayUsed;

    default:
      return assertNever(ruleKind);
  }
};



//The first function receives the level and rule settings.
//The returned function receives the request information.
export const makeRule = (
  level: Level,
  config: RuleConfig,
): Rule => {

  return (input) => {

    // Calculate how many units this rule allows right now.
    const remaining = headroomFor(
      config.kind,
      config.limit,
      input.usage,
    );

    // If the request fits within the limit, there is no violation.
    if (input.requested <= remaining) {
      return null;
    }

    // Otherwise, describe why the request was rejected.
    return {
      level,
      rule: config.kind,
      limit: config.limit,
      used: usedFor(config.kind, input.usage),
      remaining,
      requested: input.requested,
    };
  };
};


//Each rule configuration becomes a rule function.
export const buildRules = (
  level: Level,
  plan: Plan,
): readonly Rule[] => {

  return plan.rules.map((config) => {
    return makeRule(level, config);
  });
};



export const headroom = (
  plan: Plan,
  usage: UsageSnapshot,
): number => {

  let maximumAllowed = Number.POSITIVE_INFINITY;

  for (const config of plan.rules) {

    const allowedByThisRule = headroomFor(
      config.kind,
      config.limit,
      usage,
    );

    maximumAllowed = Math.min(
      maximumAllowed,
      allowedByThisRule,
    );
  }

  return maximumAllowed;
};


// Get the remaining units for one specific rule.
// Returns null if the plan does not contain that rule.

export const remainingFor = (
  plan: Plan,
  ruleKind: RuleKind,
  usage: UsageSnapshot,
): number | null => {

  const config = plan.rules.find((rule) => {
    return rule.kind === ruleKind;
  });

  if (config === undefined) {
    return null;
  }

  return headroomFor(
    ruleKind,
    config.limit,
    usage,
  );
};
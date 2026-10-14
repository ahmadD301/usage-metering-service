import { pipe } from "../shared/pipe.js";
import { buildRules } from "./rules.js";

import type {
  Decision,
  EvaluationContext,
  Level,
  LevelState,
  RuleKind,
  Units,
  Violation,
} from "./types.js";


// Add the level to a plan and its usage.
//This allows us to process account and user states using the same structure.
type LevelEntry = LevelState & {
  readonly level: Level;
};


// Define rule priority.
const RULE_ORDER: Readonly<Record<RuleKind, number>> = {
  max_per_request: 0,
  daily_allowance: 1,
  monthly_allowance: 2,
};



// 3. Define level priority.
const LEVEL_ORDER: Readonly<Record<Level, number>> = {
  account: 0,
  user: 1,
};




// Sort violations by priority.
const byPriority = (
  first: Violation,
  second: Violation,
): number => {

  const rulePriority =
    RULE_ORDER[first.rule] - RULE_ORDER[second.rule];

  if (rulePriority !== 0) {
    return rulePriority;
  }
  return LEVEL_ORDER[first.level] - LEVEL_ORDER[second.level];
};


const isViolation = (
  value: Violation | null,
): value is Violation => {

  return value !== null;
};


// Collect account and user information.
const levelsOf = (
  context: EvaluationContext,
): readonly LevelEntry[] => {

  return [
    {
      level: "account",
      ...context.account,
    },
    {
      level: "user",
      ...context.user,
    },
  ];
};


// Convert the violations into a final decision.
const toDecision = (
  requested: Units,
  violations: readonly Violation[],
): Decision => {

  // No violations means the request is accepted.
  if (violations.length === 0) {
    return {
      kind: "accepted",
      units: requested,
    };
  }

  // The first violation is the highest-priority one.
  const primary = violations[0]!;

  return {
    kind: "rejected",
    primary,
    violations: [primary, ...violations.slice(1)],
  };
};


//Evaluate the request against every rule.
export const evaluate = (
  context: EvaluationContext,
): Decision => {

  const violations = pipe(

    // get both account and user states.
    levelsOf(context),

    // build and execute every rule.
    (entries) =>
      entries.flatMap(({ level, plan, usage }) =>
        buildRules(level, plan).map((rule) =>
          rule({
            requested: context.requested,
            usage,
          }),
        ),
      ),

    // remove null results.
    (results) => results.filter(isViolation),

    // Sort violations by priority.
    (found) => [...found].sort(byPriority),
  );

  // Return the final decision.
  return toDecision(context.requested, violations);
};
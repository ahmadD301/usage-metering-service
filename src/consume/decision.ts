import type { Decision, Plan, UsageSnapshot } from "../domain/index.js";
import { addUsage, remainingSummary } from "../domain/usage.js";
import type { PlanRef, StoredDecision } from "./types.js";

type LevelView = { readonly plan: Plan; readonly usage: UsageSnapshot };

export type DecisionInput = {
  readonly requestId: string;
  readonly userId: string;
  readonly units: number;
  readonly now: Date;
  readonly decision: Decision;
  //Usage BEFORE this request.
  readonly account: LevelView;
  readonly user: LevelView;
};

const planRef = (plan: Plan): PlanRef => ({ id: plan.id, name: plan.name });

// Usage as it stands after the decision: accepted units are added, rejections change nothing.
const usageAfter = (decision: Decision, usage: UsageSnapshot): UsageSnapshot =>
  decision.kind === "accepted" ? addUsage(usage, decision.units) : usage;

export const buildStoredDecision = (input: DecisionInput): StoredDecision => {
  const { decision } = input;
  return {
    requestId: input.requestId,
    userId: input.userId,
    units: input.units,
    accepted: decision.kind === "accepted",
    reason:
      decision.kind === "accepted"
        ? null
        : { primary: decision.primary, violations: decision.violations },
    plans: {
      account: planRef(input.account.plan),
      user: planRef(input.user.plan),
    },
    remaining: {
      account: remainingSummary(
        input.account.plan,
        usageAfter(decision, input.account.usage),
      ),
      user: remainingSummary(
        input.user.plan,
        usageAfter(decision, input.user.usage),
      ),
    },
    decidedAt: input.now.toISOString(),
  };
};

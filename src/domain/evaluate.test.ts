import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import { headroom, remainingFor } from "./rules.js";
import type {
  Decision,
  EvaluationContext,
  Level,
  Plan,
  RuleConfig,
  Units,
  UsageSnapshot,
} from "./types.js";
import { parseUnits } from "./units.js";

const units = (n: number): Units => {
  const parsed = parseUnits(n);
  if (parsed.type !== "ok") throw new Error(`invalid test units: ${String(n)}`);
  return parsed.value;
};

const usage = (monthUsed = 0, dayUsed = 0): UsageSnapshot => ({
  monthUsed,
  dayUsed,
});

const plan = (scope: Level, rules: readonly RuleConfig[]): Plan => ({
  id: `${scope}-plan`,
  name: `${scope} plan`,
  scope,
  rules,
});

// The brief's example: account 10,000/month + 100/request; user 1,000/month + 20/request.
const accountPlan = plan("account", [
  { kind: "monthly_allowance", limit: 10_000 },
  { kind: "max_per_request", limit: 100 },
]);
const userPlan = plan("user", [
  { kind: "monthly_allowance", limit: 1_000 },
  { kind: "max_per_request", limit: 20 },
]);

const context = (
  requested: number,
  accountUsage: UsageSnapshot = usage(),
  userUsage: UsageSnapshot = usage(),
): EvaluationContext => ({
  requested: units(requested),
  account: { plan: accountPlan, usage: accountUsage },
  user: { plan: userPlan, usage: userUsage },
});

const expectRejected = (
  decision: Decision,
): Extract<Decision, { kind: "rejected" }> => {
  if (decision.kind !== "rejected") throw new Error("expected a rejection");
  return decision;
};

describe("evaluate: examples from the brief", () => {
  it("rejects 25 units because of the user's per-request limit, even with plenty of allowance", () => {
    const decision = expectRejected(evaluate(context(25)));
    expect(decision.violations).toHaveLength(1);
    expect(decision.primary).toMatchObject({
      level: "user",
      rule: "max_per_request",
      limit: 20,
      requested: 25,
    });
  });

  it("accepts 10 units when both levels have enough remaining", () => {
    expect(evaluate(context(10))).toEqual({ kind: "accepted", units: 10 });
  });

  it("rejects 10 units when the account has only 5 remaining, even if the user has plenty", () => {
    const decision = expectRejected(
      evaluate(context(10, usage(9_995), usage(0))),
    );
    expect(decision.violations).toHaveLength(1);
    expect(decision.primary).toEqual({
      level: "account",
      rule: "monthly_allowance",
      limit: 10_000,
      used: 9_995,
      remaining: 5,
      requested: 10,
    });
  });
});

describe("evaluate: boundaries", () => {
  it("accepts exactly the remaining amount and rejects one more", () => {
    expect(evaluate(context(5, usage(9_995))).kind).toBe("accepted");
    expect(evaluate(context(6, usage(9_995))).kind).toBe("rejected");
  });

  it("accepts exactly the per-request maximum and rejects one more", () => {
    expect(evaluate(context(20)).kind).toBe("accepted");
    expect(evaluate(context(21)).kind).toBe("rejected");
  });

  it("treats a plan with no rules as unlimited", () => {
    const unlimited: EvaluationContext = {
      requested: units(1_000_000),
      account: { plan: plan("account", []), usage: usage(5, 5) },
      user: { plan: plan("user", []), usage: usage(5, 5) },
    };
    expect(evaluate(unlimited).kind).toBe("accepted");
    expect(headroom(plan("user", []), usage())).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("evaluate: violation ordering", () => {
  it("reports per-request limits first, account before user", () => {
    const decision = expectRejected(evaluate(context(500)));
    expect(decision.violations.map((v) => [v.level, v.rule])).toEqual([
      ["account", "max_per_request"],
      ["user", "max_per_request"],
    ]);
    expect(decision.primary).toBe(decision.violations[0]);
  });

  it("lists every violated rule, per-request before monthly", () => {
    const decision = expectRejected(evaluate(context(1_500)));
    expect(decision.violations.map((v) => [v.level, v.rule])).toEqual([
      ["account", "max_per_request"],
      ["user", "max_per_request"],
      ["user", "monthly_allowance"],
    ]);
  });
});

describe("evaluate: daily allowance (extra rule)", () => {
  const dailyUserPlan = plan("user", [
    { kind: "monthly_allowance", limit: 1_000 },
    { kind: "daily_allowance", limit: 50 },
    { kind: "max_per_request", limit: 20 },
  ]);
  const withUserUsage = (userUsage: UsageSnapshot): EvaluationContext => ({
    ...context(10),
    user: { plan: dailyUserPlan, usage: userUsage },
  });

  it("rejects on the daily cap even though the month has room", () => {
    const decision = expectRejected(evaluate(withUserUsage(usage(100, 45))));
    expect(decision.primary).toEqual({
      level: "user",
      rule: "daily_allowance",
      limit: 50,
      used: 45,
      remaining: 5,
      requested: 10,
    });
  });

  it("reports the daily cap before the monthly allowance when both are violated", () => {
    const decision = expectRejected(evaluate(withUserUsage(usage(995, 45))));
    expect(decision.violations.map((v) => v.rule)).toEqual([
      "daily_allowance",
      "monthly_allowance",
    ]);
  });

  it("accepts again on a new day because daily usage starts at zero", () => {
    expect(evaluate(withUserUsage(usage(100, 0))).kind).toBe("accepted");
  });
});

describe("evaluate: plan changes keep consumed usage", () => {
  const shrunk = plan("user", [{ kind: "monthly_allowance", limit: 500 }]);
  const grown = plan("user", [{ kind: "monthly_allowance", limit: 2_000 }]);
  const alreadyUsed = usage(800);

  it("shows 0 remaining and rejects when the allowance is below existing usage", () => {
    expect(remainingFor(shrunk, "monthly_allowance", alreadyUsed)).toBe(0);
    expect(headroom(shrunk, alreadyUsed)).toBe(0);
    const decision = expectRejected(
      evaluate({ ...context(1), user: { plan: shrunk, usage: alreadyUsed } }),
    );
    expect(decision.primary).toMatchObject({
      level: "user",
      rule: "monthly_allowance",
      remaining: 0,
    });
  });

  it("allows consumption again once the allowance exceeds usage, without resetting usage", () => {
    expect(remainingFor(grown, "monthly_allowance", alreadyUsed)).toBe(1_200);
    expect(
      evaluate({ ...context(10), user: { plan: grown, usage: alreadyUsed } })
        .kind,
    ).toBe("accepted");
  });

  it("returns null remaining for a rule kind the plan does not have", () => {
    expect(remainingFor(shrunk, "daily_allowance", alreadyUsed)).toBeNull();
  });
});

describe("headroom", () => {
  it("is the tightest of all rules", () => {
    // per-request 20, monthly remaining 1000 - 990 = 10
    expect(headroom(userPlan, usage(990))).toBe(10);
  });
});

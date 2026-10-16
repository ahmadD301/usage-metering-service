import { describe, expect, it } from "vitest";
import { evaluate, parseUnits, type EvaluationContext, type Plan } from "../domain/index.js";
import { buildStoredDecision } from "./decision.js";

const accountPlan: Plan = {
  id: "acct-plan",
  name: "Starter",
  scope: "account",
  rules: [
    { kind: "monthly_allowance", limit: 100 },
    { kind: "max_per_request", limit: 50 },
  ],
};
const userPlan: Plan = {
  id: "user-plan",
  name: "Basic",
  scope: "user",
  rules: [
    { kind: "monthly_allowance", limit: 30 },
    { kind: "max_per_request", limit: 20 },
  ],
};

const NOW = new Date("2026-10-16T10:00:00.000Z");

const run = (requested: number, accountUsed: number, userUsed: number) => {
  const parsed = parseUnits(requested);
  if (parsed.type !== "ok") throw new Error("bad test units");
  const account = { plan: accountPlan, usage: { monthUsed: accountUsed, dayUsed: accountUsed } };
  const user = { plan: userPlan, usage: { monthUsed: userUsed, dayUsed: userUsed } };
  const context: EvaluationContext = { requested: parsed.value, account, user };
  return buildStoredDecision({
    requestId: "r1",
    userId: "alice",
    units: requested,
    now: NOW,
    decision: evaluate(context),
    account,
    user,
  });
};

describe("buildStoredDecision", () => {
  it("for an accepted request, remaining reflects the units just consumed", () => {
    const stored = run(10, 40, 5);
    expect(stored).toMatchObject({ accepted: true, reason: null, units: 10, userId: "alice" });
    expect(stored.remaining.account.monthlyAllowance).toBe(50);
    expect(stored.remaining.user.monthlyAllowance).toBe(15);
    expect(stored.decidedAt).toBe("2026-10-16T10:00:00.000Z");
  });

  it("for a rejection, remaining is unchanged and the reason carries every violation", () => {
    const stored = run(25, 40, 20);
    expect(stored.accepted).toBe(false);
    expect(stored.reason?.primary).toMatchObject({ level: "user", rule: "max_per_request" });
    expect(stored.reason?.violations.length).toBeGreaterThanOrEqual(2);
    expect(stored.remaining.account.monthlyAllowance).toBe(60);
    expect(stored.remaining.user.monthlyAllowance).toBe(10);
  });

  it("records which plans applied", () => {
    expect(run(1, 0, 0).plans).toEqual({
      account: { id: "acct-plan", name: "Starter" },
      user: { id: "user-plan", name: "Basic" },
    });
  });
});
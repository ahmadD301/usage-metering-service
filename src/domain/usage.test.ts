import { describe, expect, it } from "vitest";
import type { Plan } from "./types.js";
import { addUsage, emptyUsage, remainingSummary } from "./usage.js";

const userPlan: Plan = {
  id: "p",
  name: "Basic",
  scope: "user",
  rules: [
    { kind: "monthly_allowance", limit: 1_000 },
    { kind: "max_per_request", limit: 20 },
  ],
};

describe("addUsage", () => {
  it("adds to both counters without mutating the input", () => {
    const before = { monthUsed: 10, dayUsed: 4 };
    const after = addUsage(before, 6);
    expect(after).toEqual({ monthUsed: 16, dayUsed: 10 });
    expect(before).toEqual({ monthUsed: 10, dayUsed: 4 });
    expect(emptyUsage).toEqual({ monthUsed: 0, dayUsed: 0 });
  });
});

describe("remainingSummary", () => {
  it("reports remaining per rule kind and null for kinds the plan lacks", () => {
    expect(remainingSummary(userPlan, { monthUsed: 990, dayUsed: 990 })).toEqual({
      monthlyAllowance: 10,
      dailyAllowance: null,
      maxPerRequest: 20,
    });
  });

  it("never goes below zero when the allowance is under existing usage", () => {
    expect(remainingSummary(userPlan, { monthUsed: 5_000, dayUsed: 0 }).monthlyAllowance).toBe(0);
  });
});
import { describe, expect, it } from "vitest";
import { findProblems, type AccountTotals } from "../../load-tests/verify.js";

const row = (overrides: Partial<AccountTotals> = {}): AccountTotals => ({
  name: "load-x",
  month: "2026-10-01",
  counter: 100,
  usersTotal: 100,
  acceptedUnits: 100,
  requests: 120,
  allowance: 1_000,
  ...overrides,
});

const relaxed = { expectSaturated: false };

describe("findProblems", () => {
  it("reports nothing when the three totals agree and the allowance is respected", () => {
    expect(findProblems([row()], relaxed)).toEqual([]);
  });

  it("flags an account counter that differs from the sum of user counters", () => {
    const problems = findProblems([row({ usersTotal: 99 })], relaxed);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/sum of user counters/);
  });

  it("flags a counter that differs from the accepted requests", () => {
    const problems = findProblems([row({ acceptedUnits: 101 })], relaxed);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/accepted requests/);
  });

  it("flags overspending", () => {
    const problems = findProblems(
      [
        row({
          counter: 101,
          usersTotal: 101,
          acceptedUnits: 101,
          allowance: 100,
        }),
      ],
      relaxed,
    );
    expect(problems.some((problem) => problem.includes("OVERSPENT"))).toBe(
      true,
    );
  });

  it("accepts a missing allowance (unlimited)", () => {
    expect(findProblems([row({ allowance: null })], relaxed)).toEqual([]);
  });

  it("when saturation is expected, requires the allowance to be exactly used", () => {
    const exact = row({
      counter: 50,
      usersTotal: 50,
      acceptedUnits: 50,
      allowance: 50,
    });
    expect(findProblems([exact], { expectSaturated: true })).toEqual([]);

    const under = row({
      counter: 49,
      usersTotal: 49,
      acceptedUnits: 49,
      allowance: 50,
    });
    expect(findProblems([under], { expectSaturated: true })).toHaveLength(1);
    expect(
      findProblems([row({ allowance: null })], { expectSaturated: true }),
    ).toHaveLength(1);
  });

  it("collects problems from every row", () => {
    const rows = [
      row({ name: "a", usersTotal: 1 }),
      row({ name: "b", acceptedUnits: 2 }),
    ];
    expect(findProblems(rows, relaxed)).toHaveLength(2);
  });
});

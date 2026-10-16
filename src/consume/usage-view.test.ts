import { describe, expect, it } from "vitest";
import type { Plan } from "../domain/index.js";
import { buildUsageView, periodFor } from "./usage-view.js";

const NOW = new Date("2026-10-16T10:00:00.000Z");
const plan: Plan = {
  id: "p",
  name: "Basic",
  scope: "user",
  rules: [{ kind: "monthly_allowance", limit: 100 }],
};

describe("periodFor", () => {
  it("defaults to the current UTC month and day", () => {
    expect(periodFor(undefined, NOW)).toEqual({
      monthStart: "2026-10-01",
      label: "2026-10",
      isCurrent: true,
      dayStart: "2026-10-16",
    });
  });

  it("treats an explicit current month the same way", () => {
    expect(periodFor("2026-10", NOW).isCurrent).toBe(true);
  });

  it("marks other months as past, with no day", () => {
    expect(periodFor("2026-09", NOW)).toEqual({
      monthStart: "2026-09-01",
      label: "2026-09",
      isCurrent: false,
      dayStart: null,
    });
  });
});

describe("buildUsageView", () => {
  const usage = { monthUsed: 40, dayUsed: 15 };

  it("shows today and remaining for the current month", () => {
    const view = buildUsageView(periodFor(undefined, NOW), plan, usage);
    expect(view.consumed).toEqual({ month: 40, today: 15 });
    expect(view.remaining?.monthlyAllowance).toBe(60);
  });

  it("shows only consumed units for a past month", () => {
    const view = buildUsageView(periodFor("2026-09", NOW), plan, usage);
    expect(view.consumed).toEqual({ month: 40, today: null });
    expect(view.remaining).toBeNull();
  });
});
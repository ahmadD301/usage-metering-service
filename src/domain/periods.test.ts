
import { describe, expect, it } from "vitest";
import { dayPeriodKey, monthPeriodKey } from "./periods.js";

describe("UTC period keys", () => {
  it("keeps the last millisecond of a month in that month", () => {
    expect(monthPeriodKey(new Date("2026-10-31T23:59:59.999Z"))).toBe("2026-10-01");
  });

  it("starts a new month at exactly midnight UTC", () => {
    expect(monthPeriodKey(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-11-01");
  });

  it("handles the year boundary", () => {
    expect(monthPeriodKey(new Date("2026-12-31T23:59:59.999Z"))).toBe("2026-12-01");
    expect(monthPeriodKey(new Date("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
  });

  it("uses UTC even when the instant is a different local date", () => {
    // 23:30 at UTC-05:00 on Oct 31 is already Nov 1 in UTC.
    expect(monthPeriodKey(new Date("2026-10-31T23:30:00-05:00"))).toBe("2026-11-01");
  });

  it("computes day keys, including a leap day", () => {
    expect(dayPeriodKey(new Date("2028-02-29T12:00:00Z"))).toBe("2028-02-29");
    expect(dayPeriodKey(new Date("2028-02-29T23:59:59.999Z"))).toBe("2028-02-29");
    expect(dayPeriodKey(new Date("2028-03-01T00:00:00Z"))).toBe("2028-03-01");
  });
});
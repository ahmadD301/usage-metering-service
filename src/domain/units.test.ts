
import { describe, expect, it } from "vitest";
import { MAX_UNITS_PER_REQUEST, parseUnits } from "./units.js";

describe("parseUnits", () => {
  it("accepts positive whole numbers up to the maximum", () => {
    expect(parseUnits(1).type).toBe("ok");
    expect(parseUnits(MAX_UNITS_PER_REQUEST).type).toBe("ok");
  });

  it.each([0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "10", null, undefined])(
    "rejects %s as not a positive integer",
    (input) => {
      expect(parseUnits(input)).toEqual({ type: "err", error: "not_a_positive_integer" });
    },
  );

  it("rejects values above the maximum", () => {
    expect(parseUnits(MAX_UNITS_PER_REQUEST + 1)).toEqual({ type: "err", error: "too_large" });
    expect(parseUnits(1e30)).toEqual({ type: "err", error: "too_large" });
  });
});
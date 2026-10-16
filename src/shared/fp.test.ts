import { describe, expect, it } from "vitest";
import { pipe } from "./pipe.js";
import { andThen, err, mapResult, match, ok, type Result } from "./result.js";

describe("pipe", () => {
  it("returns the value untouched with no functions", () => {
    expect(pipe(5)).toBe(5);
  });

  it("applies functions left to right", () => {
    const result = pipe(
      3,
      (n) => n + 1,
      (n) => n * 10,
      (n) => `v${String(n)}`,
    );
    expect(result).toBe("v40");
  });
});

describe("Result helpers", () => {
  const half = (n: number): Result<number, "odd"> =>
    n % 2 === 0 ? ok(n / 2) : err("odd");

  it("mapResult transforms only the ok branch", () => {
    expect(mapResult(ok(2), (n) => n + 1)).toEqual(ok(3));
    expect(mapResult(err("boom"), (n: number) => n + 1)).toEqual(err("boom"));
  });

  it("andThen chains fallible steps and stops at the first error", () => {
    expect(andThen(half(8), half)).toEqual(ok(2));
    expect(andThen(half(6), half)).toEqual(err("odd"));
  });

  it("match folds a result into one value", () => {
    const render = (r: Result<number, string>): string =>
      match(r, { ok: (v) => `ok:${String(v)}`, err: (e) => `err:${e}` });
    expect(render(ok(1))).toBe("ok:1");
    expect(render(err("x"))).toBe("err:x");
  });
});

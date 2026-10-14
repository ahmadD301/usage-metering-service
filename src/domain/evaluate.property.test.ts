import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import { headroom } from "./rules.js";
import {
  RULE_KINDS,
  type EvaluationContext,
  type Level,
  type Plan,
  type RuleConfig,
  type Units,
  type UsageSnapshot,
} from "./types.js";
import { parseUnits } from "./units.js";

const units = (n: number): Units => {
  const parsed = parseUnits(n);
  if (parsed.type !== "ok") throw new Error(`invalid test units: ${String(n)}`);
  return parsed.value;
};

const ruleConfig: fc.Arbitrary<RuleConfig> = fc.record({
  kind: fc.constantFrom(...RULE_KINDS),
  limit: fc.integer({ min: 0, max: 10_000 }),
});

const planFor = (scope: Level): fc.Arbitrary<Plan> =>
  fc.record({
    id: fc.constant("p"),
    name: fc.constant("p"),
    scope: fc.constant(scope),
    rules: fc.array(ruleConfig, { maxLength: 4 }),
  });

const usageArb: fc.Arbitrary<UsageSnapshot> = fc.record({
  monthUsed: fc.integer({ min: 0, max: 20_000 }),
  dayUsed: fc.integer({ min: 0, max: 20_000 }),
});

const contextArb: fc.Arbitrary<EvaluationContext> = fc.record({
  requested: fc.integer({ min: 1, max: 30_000 }).map(units),
  account: fc.record({ plan: planFor("account"), usage: usageArb }),
  user: fc.record({ plan: planFor("user"), usage: usageArb }),
});

describe("evaluate: properties", () => {
  it("accepts exactly when both levels have enough headroom for the full amount", () => {
    fc.assert(
      fc.property(contextArb, (ctx) => {
        const fits =
          ctx.requested <= headroom(ctx.account.plan, ctx.account.usage) &&
          ctx.requested <= headroom(ctx.user.plan, ctx.user.usage);
        expect(evaluate(ctx).kind === "accepted").toBe(fits);
      }),
    );
  });

  it("is deterministic and never mutates its input", () => {
    fc.assert(
      fc.property(contextArb, (ctx) => {
        const before = structuredClone(ctx);
        const first = evaluate(ctx);
        const second = evaluate(ctx);
        expect(first).toEqual(second);
        expect(ctx).toEqual(before);
      }),
    );
  });

  it("only reports violations that are genuinely short of the requested amount", () => {
    fc.assert(
      fc.property(contextArb, (ctx) => {
        const decision = evaluate(ctx);
        if (decision.kind === "rejected") {
          expect(decision.primary).toBe(decision.violations[0]);
          for (const violation of decision.violations) {
            expect(violation.remaining).toBeLessThan(violation.requested);
            expect(violation.remaining).toBeGreaterThanOrEqual(0);
          }
        }
      }),
    );
  });

  it("is monotonic: if N units are accepted, any smaller amount is accepted too", () => {
    fc.assert(
      fc.property(contextArb, fc.integer({ min: 1, max: 30_000 }), (ctx, smaller) => {
        fc.pre(smaller <= ctx.requested);
        fc.pre(evaluate(ctx).kind === "accepted");
        expect(evaluate({ ...ctx, requested: units(smaller) }).kind).toBe("accepted");
      }),
    );
  });
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_PLAN_ID,
  DEFAULT_USER_PLAN_ID,
  PREDEFINED_PLANS,
} from "../../src/db/predefined-plans.js";
import { findPlanById, listPredefinedPlans } from "../../src/db/plans.js";
import { seedPredefinedPlans } from "../../src/db/seed.js";
import { createTestDb, type TestDb } from "../helpers/test-db.js";

describe("predefined plans", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("seeds Starter, Pro, Basic and Premium", async () => {
    const plans = await listPredefinedPlans(db.pool);
    expect(plans.map((plan) => `${plan.scope}:${plan.name}`)).toEqual([
      "account:Pro",
      "account:Starter",
      "user:Basic",
      "user:Premium",
    ]);
    expect(
      plans.every((plan) => plan.predefined && plan.ownerAccountId === null),
    ).toBe(true);
  });

  it("stores the documented limits", async () => {
    const basic = await findPlanById(db.pool, DEFAULT_USER_PLAN_ID);
    expect(basic).toMatchObject({ name: "Basic", scope: "user" });
    expect(basic?.rules).toHaveLength(2);
    expect(basic?.rules).toEqual(
      expect.arrayContaining([
        { kind: "monthly_allowance", limit: 1_000 },
        { kind: "max_per_request", limit: 20 },
      ]),
    );

    const starter = await findPlanById(db.pool, DEFAULT_ACCOUNT_PLAN_ID);
    expect(starter?.rules).toEqual(
      expect.arrayContaining([
        { kind: "monthly_allowance", limit: 10_000 },
        { kind: "max_per_request", limit: 100 },
      ]),
    );
  });

  it("matches the constants in predefined-plans.ts exactly", async () => {
    const stored = await listPredefinedPlans(db.pool);
    for (const expected of PREDEFINED_PLANS) {
      const plan = stored.find((candidate) => candidate.id === expected.id);
      expect(plan?.name).toBe(expected.name);
      expect(plan?.rules).toHaveLength(expected.rules.length);
      expect(plan?.rules).toEqual(expect.arrayContaining([...expected.rules]));
    }
  });

  it("is idempotent: seeding again adds no plans or rules", async () => {
    await seedPredefinedPlans(db.pool);
    await seedPredefinedPlans(db.pool);

    const counts = await db.pool.query<{ plans: number; rules: number }>(
      `SELECT (SELECT count(*) FROM plans)::int AS plans,
              (SELECT count(*) FROM plan_rules)::int AS rules`,
    );
    expect(counts.rows[0]).toEqual({ plans: 4, rules: 8 });
  });

  it("returns null for an unknown plan id", async () => {
    expect(
      await findPlanById(db.pool, "11111111-1111-4111-8111-111111111111"),
    ).toBeNull();
  });
});

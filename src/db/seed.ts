import type pg from "pg";
import { withTransaction } from "./client.js";
import { PREDEFINED_PLANS } from "./predefined-plans.js";

export const seedPredefinedPlans = async (pool: pg.Pool): Promise<void> => {
  await withTransaction(pool, async (client) => {
    for (const plan of PREDEFINED_PLANS) {
      await client.query(
        `INSERT INTO plans (id, scope, name, owner_account_id)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [plan.id, plan.scope, plan.name],
      );
      for (const rule of plan.rules) {
        await client.query(
          `INSERT INTO plan_rules (plan_id, kind, limit_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (plan_id, kind) DO NOTHING`,
          [plan.id, rule.kind, rule.limit],
        );
      }
    }
  });
};

/*
 * Purpose: an idempotent seed. ON CONFLICT DO NOTHING
 * means running it on every startup is safe, 
 * even from two instances at once.
 * It never overwrites existing rows, 
 * so a predefined plan’s limits can’t change by editing the constants.
 * a change needs a new migration, which fits the “read-only” requirement.
 */
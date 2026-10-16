import type pg from "pg";
import type { Level, Plan, RuleConfig } from "../domain/index.js";
import { err, ok, type Result } from "../shared/result.js";
import { withTransaction, type Queryable } from "./client.js";
import { pgErrorCode, UNIQUE_VIOLATION } from "./errors.js";

export type PlanRecord = Plan & {
  readonly ownerAccountId: string | null;
  readonly predefined: boolean;
};

export type PlanLookupError = "plan_not_found" | "plan_scope_mismatch";
export type PlanUpdateError =
  "plan_not_found" | "plan_read_only" | "name_taken";

export type PlanInput = {
  readonly name: string;
  readonly rules: readonly RuleConfig[];
};

type PlanRow = {
  id: string;
  name: string;
  scope: Level;
  owner_account_id: string | null;
  rules: RuleConfig[];
};

const PLAN_SELECT = `
  SELECT p.id, p.name, p.scope, p.owner_account_id,
         COALESCE(
           json_agg(json_build_object('kind', r.kind, 'limit', r.limit_value) ORDER BY r.kind)
             FILTER (WHERE r.plan_id IS NOT NULL),
           '[]'::json
         ) AS rules
  FROM plans p
  LEFT JOIN plan_rules r ON r.plan_id = p.id
`;

const toRecord = (row: PlanRow): PlanRecord => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  ownerAccountId: row.owner_account_id,
  predefined: row.owner_account_id === null,
  rules: row.rules,
});

// Callers must pass a valid UUID
export const findPlanById = async (
  db: Queryable,
  id: string,
): Promise<PlanRecord | null> => {
  const result = await db.query<PlanRow>(
    `${PLAN_SELECT} WHERE p.id = $1 GROUP BY p.id`,
    [id],
  );
  const [row] = result.rows;
  return row === undefined ? null : toRecord(row);
};

export const listPredefinedPlans = async (
  db: Queryable,
): Promise<readonly PlanRecord[]> => {
  const result = await db.query<PlanRow>(
    `${PLAN_SELECT} WHERE p.owner_account_id IS NULL GROUP BY p.id ORDER BY p.scope, p.name`,
  );
  return result.rows.map(toRecord);
};

//Predefined plans are visible to everyone; custom plans only to their owner. Pure.
export const isVisibleTo = (
  plan: PlanRecord,
  accountId: string | null,
): boolean => plan.ownerAccountId === null || plan.ownerAccountId === accountId;

/** Predefined plans first, then the account's own custom plans. */
export const listPlansForAccount = async (
  db: Queryable,
  accountId: string,
): Promise<readonly PlanRecord[]> => {
  const result = await db.query<PlanRow>(
    `${PLAN_SELECT}
     WHERE p.owner_account_id IS NULL OR p.owner_account_id = $1
     GROUP BY p.id
     ORDER BY p.owner_account_id NULLS FIRST, p.scope, p.name`,
    [accountId],
  );
  return result.rows.map(toRecord);
};

export const findVisiblePlan = async (
  db: Queryable,
  accountId: string,
  planId: string,
): Promise<PlanRecord | null> => {
  const plan = await findPlanById(db, planId);
  return plan !== null && isVisibleTo(plan, accountId) ? plan : null;
};

export const findAssignablePlan = async (
  db: Queryable,
  accountId: string | null,
  planId: string,
  scope: Level,
): Promise<Result<PlanRecord, PlanLookupError>> => {
  const plan = await findPlanById(db, planId);
  if (plan === null || !isVisibleTo(plan, accountId)) {
    return err("plan_not_found");
  }
  return plan.scope === scope ? ok(plan) : err("plan_scope_mismatch");
};

const insertRules = async (
  db: Queryable,
  planId: string,
  rules: readonly RuleConfig[],
): Promise<void> => {
  if (rules.length === 0) {
    return;
  }
  await db.query(
    `INSERT INTO plan_rules (plan_id, kind, limit_value)
     SELECT $1::uuid, t.kind, t.limit_value
     FROM unnest($2::text[], $3::bigint[]) AS t(kind, limit_value)`,
    [planId, rules.map((rule) => rule.kind), rules.map((rule) => rule.limit)],
  );
};

const requirePlan = async (
  db: Queryable,
  planId: string,
): Promise<PlanRecord> => {
  const plan = await findPlanById(db, planId);
  if (plan === null) {
    throw new Error(`Plan ${planId} disappeared inside its own transaction`);
  }
  return plan;
};

export const createCustomPlan = async (
  pool: pg.Pool,
  accountId: string,
  input: PlanInput & { readonly scope: Level },
): Promise<Result<PlanRecord, "name_taken">> => {
  try {
    const plan = await withTransaction(pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO plans (scope, name, owner_account_id) VALUES ($1, $2, $3) RETURNING id",
        [input.scope, input.name, accountId],
      );
      const [row] = inserted.rows;
      if (row === undefined) {
        throw new Error("INSERT INTO plans returned no row");
      }
      await insertRules(client, row.id, input.rules);
      return requirePlan(client, row.id);
    });
    return ok(plan);
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      return err("name_taken");
    }
    throw error;
  }
};

//Replaces a custom plan's name and rules atomically.
//The plan row is locked first, so two
//concurrent updates serialize,
//and readers see either the old rules or the new ones.

export const updateCustomPlan = async (
  pool: pg.Pool,
  accountId: string,
  planId: string,
  input: PlanInput,
): Promise<Result<PlanRecord, PlanUpdateError>> => {
  try {
    return await withTransaction(
      pool,
      async (client): Promise<Result<PlanRecord, PlanUpdateError>> => {
        const locked = await client.query<{ owner_account_id: string | null }>(
          "SELECT owner_account_id FROM plans WHERE id = $1 FOR UPDATE",
          [planId],
        );
        const [row] = locked.rows;
        if (row === undefined) {
          return err("plan_not_found");
        }
        if (row.owner_account_id === null) {
          return err("plan_read_only");
        }
        if (row.owner_account_id !== accountId) {
          return err("plan_not_found");
        }
        await client.query("UPDATE plans SET name = $2 WHERE id = $1", [
          planId,
          input.name,
        ]);
        await client.query("DELETE FROM plan_rules WHERE plan_id = $1", [
          planId,
        ]);
        await insertRules(client, planId, input.rules);
        return ok(await requirePlan(client, planId));
      },
    );
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      return err("name_taken");
    }
    throw error;
  }
};

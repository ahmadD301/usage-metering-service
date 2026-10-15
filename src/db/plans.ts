import type { Level, Plan, RuleConfig } from "../domain/index.js";
import type { Queryable } from "./client.js";

export type PlanRecord = Plan & {
  readonly ownerAccountId: string | null;
  readonly predefined: boolean;
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

/** Callers must pass a valid UUID (HTTP input is validated at the boundary in M3). */
export const findPlanById = async (db: Queryable, id: string): Promise<PlanRecord | null> => {
  const result = await db.query<PlanRow>(`${PLAN_SELECT} WHERE p.id = $1 GROUP BY p.id`, [id]);
  const [row] = result.rows;
  return row === undefined ? null : toRecord(row);
};

export const listPredefinedPlans = async (db: Queryable): Promise<readonly PlanRecord[]> => {
  const result = await db.query<PlanRow>(
    `${PLAN_SELECT} WHERE p.owner_account_id IS NULL GROUP BY p.id ORDER BY p.scope, p.name`,
  );
  return result.rows.map(toRecord);
};
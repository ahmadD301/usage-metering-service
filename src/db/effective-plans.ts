import type { Plan, RuleConfig } from "../domain/index.js";
import type { Queryable } from "./client.js";

export type EffectivePlans = {
  readonly userInternalId: string;
  readonly accountPlan: Plan;
  readonly userPlan: Plan;
};

type Row = {
  user_id: string;
  account_plan_id: string;
  account_plan_name: string;
  account_rules: RuleConfig[];
  user_plan_id: string;
  user_plan_name: string;
  user_rules: RuleConfig[];
};

const RULES = (planAlias: string): string => `
  COALESCE(
    (SELECT json_agg(json_build_object('kind', r.kind, 'limit', r.limit_value) ORDER BY r.kind)
     FROM plan_rules r WHERE r.plan_id = ${planAlias}.id),
    '[]'::json
  )`;

const EFFECTIVE_PLANS_SQL = `
  SELECT u.id AS user_id,
         ap.id AS account_plan_id, ap.name AS account_plan_name, ${RULES("ap")} AS account_rules,
         up.id AS user_plan_id, up.name AS user_plan_name, ${RULES("up")} AS user_rules
  FROM users u
  JOIN accounts a ON a.id = u.account_id
  JOIN plans ap ON ap.id = a.plan_id
  JOIN plans up ON up.id = u.plan_id
  WHERE u.account_id = $1 AND u.external_id = $2
`;

// The account plan and user plan that apply to this user right now, or null if no such user.
export const loadEffectivePlans = async (
  db: Queryable,
  accountId: string,
  externalId: string,
): Promise<EffectivePlans | null> => {
  const result = await db.query<Row>(EFFECTIVE_PLANS_SQL, [
    accountId,
    externalId,
  ]);
  const [row] = result.rows;
  if (row === undefined) {
    return null;
  }
  return {
    userInternalId: row.user_id,
    accountPlan: {
      id: row.account_plan_id,
      name: row.account_plan_name,
      scope: "account",
      rules: row.account_rules,
    },
    userPlan: {
      id: row.user_plan_id,
      name: row.user_plan_name,
      scope: "user",
      rules: row.user_rules,
    },
  };
};

export const userExists = async (
  db: Queryable,
  accountId: string,
  externalId: string,
): Promise<boolean> => {
  const result = await db.query(
    "SELECT 1 FROM users WHERE account_id = $1 AND external_id = $2",
    [accountId, externalId],
  );
  return (result.rowCount ?? 0) > 0;
};

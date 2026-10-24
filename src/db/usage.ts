import type { UsageSnapshot } from "../domain/index.js";
import { emptyUsage } from "../domain/usage.js";
import type { Queryable } from "./client.js";

export type UsagePair = {
  readonly account: UsageSnapshot;
  readonly user: UsageSnapshot;
};

type UsageRow = {
  owner: "account" | "user";
  period_kind: "month" | "day";
  units_used: number;
};

const applyRow = (pair: UsagePair, row: UsageRow): UsagePair => {
  const current = row.owner === "account" ? pair.account : pair.user;
  const next: UsageSnapshot =
    row.period_kind === "month"
      ? { ...current, monthUsed: row.units_used }
      : { ...current, dayUsed: row.units_used };
  return row.owner === "account"
    ? { ...pair, account: next }
    : { ...pair, user: next };
};

/** Folds counter rows into usage snapshots. A missing row means zero. Pure. */
export const toUsagePair = (rows: readonly UsageRow[]): UsagePair =>
  rows.reduce(applyRow, { account: emptyUsage, user: emptyUsage });

export type UsageQuery = {
  readonly accountId: string;
  /** Internal user id, or null to read the account only. */
  readonly userId: string | null;
  /** "YYYY-MM-01" */
  readonly monthStart: string;
  /** "YYYY-MM-DD", or null when day usage is not needed. */
  readonly dayStart: string | null;
};

const USAGE_SQL = `
  SELECT 'account' AS owner, period_kind, units_used
  FROM account_usage
  WHERE account_id = $1
    AND ((period_kind = 'month' AND period_start = $2::date)
      OR (period_kind = 'day' AND $3::date IS NOT NULL AND period_start = $3::date))
  UNION ALL
  SELECT 'user' AS owner, period_kind, units_used
  FROM user_usage
  WHERE $4::uuid IS NOT NULL AND user_id = $4::uuid
    AND ((period_kind = 'month' AND period_start = $2::date)
      OR (period_kind = 'day' AND $3::date IS NOT NULL AND period_start = $3::date))
`;

export const readUsage = async (
  db: Queryable,
  query: UsageQuery,
): Promise<UsagePair> => {
  const result = await db.query<UsageRow>(USAGE_SQL, [
    query.accountId,
    query.monthStart,
    query.dayStart,
    query.userId,
  ]);
  return toUsagePair(result.rows);
};

/** Creates the account's counter row for the month if it does not exist yet. */
export const ensureAccountMonthRow = async (
  db: Queryable,
  accountId: string,
  monthStart: string,
): Promise<void> => {
  await db.query(
    `INSERT INTO account_usage (account_id, period_kind, period_start, units_used)
     VALUES ($1, 'month', $2::date, 0)
     ON CONFLICT (account_id, period_kind, period_start) DO NOTHING`,
    [accountId, monthStart],
  );
};

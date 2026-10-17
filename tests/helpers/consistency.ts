import type pg from "pg";

export type Totals = {
  readonly accountTotal: number;
  readonly usersTotal: number;
  readonly acceptedTotal: number;
  readonly requestCount: number;
};

// Units counted for one account in one month, from three independent sources
export const readTotals = async (
  pool: pg.Pool,
  accountId: string,
  monthStart: string,
): Promise<Totals> => {
  const result = await pool.query<{
    account_total: number;
    users_total: number;
    accepted_total: number;
    request_count: number;
  }>(
    `SELECT
       COALESCE((SELECT units_used FROM account_usage
                 WHERE account_id = $1 AND period_kind = 'month' AND period_start = $2::date), 0)::bigint
         AS account_total,
       COALESCE((SELECT SUM(uu.units_used) FROM user_usage uu
                 JOIN users u ON u.id = uu.user_id
                 WHERE u.account_id = $1 AND uu.period_kind = 'month' AND uu.period_start = $2::date), 0)::bigint
         AS users_total,
       COALESCE((SELECT SUM(units) FROM requests
                 WHERE account_id = $1 AND outcome = 'accepted' AND period_month = $2::date), 0)::bigint
         AS accepted_total,
       (SELECT count(*) FROM requests WHERE account_id = $1) AS request_count`,
    [accountId, monthStart],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("readTotals returned no row");
  }
  return {
    accountTotal: row.account_total,
    usersTotal: row.users_total,
    acceptedTotal: row.accepted_total,
    requestCount: row.request_count,
  };
};

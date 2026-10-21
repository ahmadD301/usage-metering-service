import { pathToFileURL } from "node:url";
import { createPool } from "../src/db/client.js";

export type AccountTotals = {
  readonly name: string;
  readonly month: string;
  readonly counter: number;
  readonly usersTotal: number;
  readonly acceptedUnits: number;
  readonly requests: number;
  readonly allowance: number | null;
};

export type VerifyOptions = { readonly expectSaturated: boolean };

/** Pure: turns database totals into human-readable problems. An empty list means consistent. */
export const findProblems = (
  rows: readonly AccountTotals[],
  options: VerifyOptions,
): readonly string[] =>
  rows.flatMap((row) => {
    const label = `${row.name} (${row.month})`;
    const problems: string[] = [];
    if (row.counter !== row.usersTotal) {
      problems.push(
        `${label}: account counter ${String(row.counter)} != sum of user counters ${String(row.usersTotal)}`,
      );
    }
    if (row.counter !== row.acceptedUnits) {
      problems.push(
        `${label}: account counter ${String(row.counter)} != sum of accepted requests ${String(row.acceptedUnits)}`,
      );
    }
    if (row.allowance !== null && row.counter > row.allowance) {
      problems.push(
        `${label}: OVERSPENT: counter ${String(row.counter)} exceeds the allowance ${String(row.allowance)}`,
      );
    }
    if (
      options.expectSaturated &&
      (row.allowance === null || row.counter !== row.allowance)
    ) {
      problems.push(
        `${label}: expected the allowance to be fully used, but the counter is ${String(row.counter)} ` +
          `and the allowance is ${row.allowance === null ? "unlimited" : String(row.allowance)}`,
      );
    }
    return problems;
  });

const TOTALS_SQL = `
  WITH scope AS (
    SELECT id, name, plan_id FROM accounts
    WHERE name LIKE $1 || '%' AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
  ),
  accounts_month AS (
    SELECT s.id, s.name, s.plan_id, au.period_start, au.units_used AS counter
    FROM scope s
    JOIN account_usage au ON au.account_id = s.id AND au.period_kind = 'month'
  ),
  users_month AS (
    SELECT u.account_id, uu.period_start, SUM(uu.units_used)::bigint AS total
    FROM users u
    JOIN user_usage uu ON uu.user_id = u.id AND uu.period_kind = 'month'
    WHERE u.account_id IN (SELECT id FROM scope)
    GROUP BY u.account_id, uu.period_start
  ),
  requests_month AS (
    SELECT r.account_id, r.period_month,
           COALESCE(SUM(r.units) FILTER (WHERE r.outcome = 'accepted'), 0)::bigint AS accepted,
           count(*)::bigint AS total
    FROM requests r
    WHERE r.account_id IN (SELECT id FROM scope)
    GROUP BY r.account_id, r.period_month
  )
  SELECT a.name AS "name",
         a.period_start::text AS "month",
         a.counter::bigint AS "counter",
         COALESCE(um.total, 0)::bigint AS "usersTotal",
         COALESCE(rm.accepted, 0)::bigint AS "acceptedUnits",
         COALESCE(rm.total, 0)::bigint AS "requests",
         (SELECT pr.limit_value FROM plan_rules pr
          WHERE pr.plan_id = a.plan_id AND pr.kind = 'monthly_allowance') AS "allowance"
  FROM accounts_month a
  LEFT JOIN users_month um ON um.account_id = a.id AND um.period_start = a.period_start
  LEFT JOIN requests_month rm ON rm.account_id = a.id AND rm.period_month = a.period_start
  ORDER BY a.name, a.period_start
`;

const argValue = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
};

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    console.error("DATABASE_URL is required");
    return 2;
  }
  const prefix = argValue(args, "--prefix") ?? "load-";
  const since = argValue(args, "--since");
  const expectSaturated = args.includes("--expect-saturated");

  const pool = createPool(url, { max: 1 });
  try {
    const result = await pool.query<AccountTotals>(TOTALS_SQL, [prefix, since]);
    const rows = result.rows;
    if (rows.length === 0) {
      console.error(
        `No accounts named "${prefix}*" found${since === null ? "" : ` since ${since}`}.`,
      );
      return 2;
    }
    console.table(rows);
    const accepted = rows.reduce((sum, row) => sum + row.acceptedUnits, 0);
    const requests = rows.reduce((sum, row) => sum + row.requests, 0);
    console.log(
      `Checked ${String(rows.length)} account-month(s): ${String(requests)} requests recorded, ` +
        `${String(accepted)} units accepted.`,
    );

    const problems = findProblems(rows, { expectSaturated });
    if (problems.length > 0) {
      console.error("CONSISTENCY PROBLEMS:");
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      return 1;
    }
    console.log(
      "Consistency check passed: counters, user totals and accepted requests all agree.",
    );
    return 0;
  } finally {
    await pool.end();
  }
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 2;
    });
}

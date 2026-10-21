import type { StoredDecision } from "../consume/types.js";
import type { Queryable } from "./client.js";

export type StoredRequest = {
  readonly fingerprint: string;
  readonly decision: StoredDecision;
};

export type HistoryCursor = {
  /** Postgres text form of the timestamp, so microseconds survive the round trip. */
  readonly createdAt: string;
  readonly id: string;
};

export type HistoryFilter = {
  readonly accountId: string;
  /** "YYYY-MM-01" or null for all months. */
  readonly month: string | null;
  readonly userExternalId: string | null;
  readonly outcome: "accepted" | "rejected" | null;
  readonly limit: number;
  readonly after: HistoryCursor | null;
};

export type HistoryEntry = { readonly decision: StoredDecision; readonly createdAt: Date };

export type HistoryPage = {
  readonly entries: readonly HistoryEntry[];
  readonly nextCursor: HistoryCursor | null;
};

type HistoryRow = {
  id: string;
  decision: StoredDecision;
  created_at: Date;
  created_at_exact: string;
};

export const listHistory = async (db: Queryable, filter: HistoryFilter): Promise<HistoryPage> => {
  const values: unknown[] = [filter.accountId];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${String(values.length)}`;
  };

  const conditions = ["r.account_id = $1"];
  if (filter.month !== null) {
    conditions.push(`r.period_month = ${bind(filter.month)}::date`);
  }
  if (filter.userExternalId !== null) {
    conditions.push(`u.external_id = ${bind(filter.userExternalId)}`);
  }
  if (filter.outcome !== null) {
    conditions.push(`r.outcome = ${bind(filter.outcome)}`);
  }
  if (filter.after !== null) {
    conditions.push(
      `(r.created_at, r.id) < (${bind(filter.after.createdAt)}::timestamptz, ${bind(filter.after.id)}::uuid)`,
    );
  }
  const limit = bind(filter.limit + 1);

  const result = await db.query<HistoryRow>(
    `SELECT r.id, r.decision, r.created_at, r.created_at::text AS created_at_exact
     FROM requests r
     JOIN users u ON u.id = r.user_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${limit}`,
    values,
  );

  const rows = result.rows.slice(0, filter.limit);
  const last = rows.at(-1);
  return {
    entries: rows.map((row) => ({ decision: row.decision, createdAt: row.created_at })),
    nextCursor:
      result.rows.length > filter.limit && last !== undefined
        ? { createdAt: last.created_at_exact, id: last.id }
        : null,
  };
};
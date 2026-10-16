import { err, ok, type Result } from "../shared/result.js";
import type { Queryable } from "./client.js";
import { exactlyOne } from "./client.js";
import { pgErrorCode, UNIQUE_VIOLATION } from "./errors.js";

export type UserRecord = {
  readonly externalId: string;
  readonly planId: string;
  readonly createdAt: Date;
};

type UserRow = { external_id: string; plan_id: string; created_at: Date };

const COLUMNS = "external_id, plan_id, created_at";

const toRecord = (row: UserRow): UserRecord => ({
  externalId: row.external_id,
  planId: row.plan_id,
  createdAt: row.created_at,
});

export const createUser = async (
  db: Queryable,
  accountId: string,
  externalId: string,
  planId: string,
): Promise<Result<UserRecord, "already_exists">> => {
  try {
    const result = await db.query<UserRow>(
      `INSERT INTO users (account_id, external_id, plan_id) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [accountId, externalId, planId],
    );
    return ok(toRecord(exactlyOne(result.rows, "inserted user")));
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      return err("already_exists");
    }
    throw error;
  }
};

export const findUser = async (
  db: Queryable,
  accountId: string,
  externalId: string,
): Promise<UserRecord | null> => {
  const result = await db.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE account_id = $1 AND external_id = $2`,
    [accountId, externalId],
  );
  const [row] = result.rows;
  return row === undefined ? null : toRecord(row);
};

export type UserPage = {
  readonly users: readonly UserRecord[];
  readonly nextCursor: string | null;
};

/** Keyset pagination on external_id: pass the previous page's nextCursor as `after`. */
export const listUsers = async (
  db: Queryable,
  accountId: string,
  options: { readonly limit: number; readonly after: string | null },
): Promise<UserPage> => {
  const result = await db.query<UserRow>(
    `SELECT ${COLUMNS} FROM users
     WHERE account_id = $1 AND ($2::text IS NULL OR external_id > $2)
     ORDER BY external_id
     LIMIT $3`,
    [accountId, options.after, options.limit + 1],
  );
  const rows = result.rows.map(toRecord);
  const users = rows.slice(0, options.limit);
  const last = users.at(-1);
  return {
    users,
    nextCursor: rows.length > options.limit && last !== undefined ? last.externalId : null,
  };
};

/** Switching plans only changes plan_id. Usage counters are untouched. */
export const setUserPlan = async (
  db: Queryable,
  accountId: string,
  externalId: string,
  planId: string,
): Promise<UserRecord | null> => {
  const result = await db.query<UserRow>(
    `UPDATE users SET plan_id = $3
     WHERE account_id = $1 AND external_id = $2
     RETURNING ${COLUMNS}`,
    [accountId, externalId, planId],
  );
  const [row] = result.rows;
  return row === undefined ? null : toRecord(row);
};
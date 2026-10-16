import type pg from "pg";
import { exactlyOne, withTransaction, type Queryable } from "./client.js";

export type AccountRecord = {
  readonly id: string;
  readonly name: string;
  readonly planId: string;
  readonly createdAt: Date;
};

type AccountRow = {
  id: string;
  name: string;
  plan_id: string;
  created_at: Date;
};

const COLUMNS = "id, name, plan_id, created_at";

const toRecord = (row: AccountRow): AccountRecord => ({
  id: row.id,
  name: row.name,
  planId: row.plan_id,
  createdAt: row.created_at,
});

export type NewAccount = {
  readonly name: string;
  readonly planId: string;
  readonly keyPrefix: string;
  readonly keyHash: string;
};

/** Creates the account and its first API key together, or neither. */
export const createAccountWithKey = (
  pool: pg.Pool,
  input: NewAccount,
): Promise<AccountRecord> =>
  withTransaction(pool, async (client) => {
    const inserted = await client.query<AccountRow>(
      `INSERT INTO accounts (name, plan_id) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [input.name, input.planId],
    );
    const account = toRecord(exactlyOne(inserted.rows, "inserted account"));
    await client.query(
      "INSERT INTO api_keys (account_id, key_prefix, key_hash) VALUES ($1, $2, $3)",
      [account.id, input.keyPrefix, input.keyHash],
    );
    return account;
  });

/** The account owning an active (not revoked) key with this hash, or null. */
export const findAccountByApiKeyHash = async (
  db: Queryable,
  keyHash: string,
): Promise<AccountRecord | null> => {
  const result = await db.query<AccountRow>(
    `SELECT a.id, a.name, a.plan_id, a.created_at
     FROM api_keys k
     JOIN accounts a ON a.id = k.account_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [keyHash],
  );
  const [row] = result.rows;
  return row === undefined ? null : toRecord(row);
};

export const setAccountPlan = async (
  db: Queryable,
  accountId: string,
  planId: string,
): Promise<AccountRecord> => {
  const result = await db.query<AccountRow>(
    `UPDATE accounts SET plan_id = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
    [accountId, planId],
  );
  return toRecord(exactlyOne(result.rows, "updated account"));
};

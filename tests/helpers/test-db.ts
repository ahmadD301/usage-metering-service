import { randomUUID } from "node:crypto";
import path from "node:path";
import type pg from "pg";
import pgModule from "pg";
import { bootstrapDatabase } from "../../src/db/bootstrap.js";
import { createPool, exactlyOne } from "../../src/db/client.js";
import { DEFAULT_ACCOUNT_PLAN_ID, DEFAULT_USER_PLAN_ID } from "../../src/db/predefined-plans.js";

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

const CONNECTION_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://metering:metering_dev_password@localhost:5432/metering";

export type TestDb = {
  readonly pool: pg.Pool;
  readonly close: () => Promise<void>;
};

type Options = {
  /** Set to false to get an empty schema (no migrations, no seed). Default: true. */
  readonly migrate?: boolean;
};

export const createTestDb = async (options: Options = {}): Promise<TestDb> => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pgModule.Pool({ connectionString: CONNECTION_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);

  const pool = createPool(CONNECTION_URL, { max: 5, options: `-c search_path=${schema}` });
  if (options.migrate !== false) {
    await bootstrapDatabase(pool, MIGRATIONS_DIR);
  }

  return {
    pool,
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
};

export const insertAccount = async (pool: pg.Pool, name: string): Promise<string> => {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO accounts (name, plan_id) VALUES ($1, $2) RETURNING id",
    [name, DEFAULT_ACCOUNT_PLAN_ID],
  );
  return exactlyOne(result.rows, "inserted account").id;
};

export const insertUser = async (
  pool: pg.Pool,
  accountId: string,
  externalId: string,
): Promise<string> => {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO users (account_id, external_id, plan_id) VALUES ($1, $2, $3) RETURNING id",
    [accountId, externalId, DEFAULT_USER_PLAN_ID],
  );
  return exactlyOne(result.rows, "inserted user").id;
};
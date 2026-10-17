import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations, runMigrations } from "../../src/db/migrate.js";
import {
  createTestDb,
  MIGRATIONS_DIR,
  type TestDb,
} from "../helpers/test-db.js";

describe("runMigrations (real migrations)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
  });
  afterAll(async () => {
    await db.close();
  });

  it("applies every pending migration once, in order, and creates the expected tables", async () => {
    const expected = (await loadMigrations(MIGRATIONS_DIR)).map(
      (migration) => migration.version,
    );
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(await runMigrations(db.pool, MIGRATIONS_DIR)).toEqual(expected);

    const tables = await db.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()",
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "account_usage",
        "accounts",
        "api_keys",
        "plan_rules",
        "plans",
        "requests",
        "schema_migrations",
        "user_usage",
        "users",
      ]),
    );
  });

  it("adds period_month to requests (migration 0002)", async () => {
    const columns = await db.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'requests'`,
    );
    expect(columns.rows.map((row) => row.column_name)).toContain(
      "period_month",
    );
  });

  it("is idempotent: a second run applies nothing", async () => {
    expect(await runMigrations(db.pool, MIGRATIONS_DIR)).toEqual([]);
  });

  it("refuses to continue if an applied migration was edited", async () => {
    await db.pool.query(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001'",
    );
    await expect(runMigrations(db.pool, MIGRATIONS_DIR)).rejects.toThrow(
      /checksum/i,
    );
  });
});

describe("runMigrations (failure handling)", () => {
  let db: TestDb;
  let dir: string;

  beforeAll(async () => {
    db = await createTestDb({ migrate: false });
    dir = await mkdtemp(path.join(os.tmpdir(), "migrations-"));
  });
  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("rolls back a failing migration completely and records nothing", async () => {
    await writeFile(
      path.join(dir, "0001_broken.sql"),
      "CREATE TABLE should_not_exist (id INT); SELECT 1 / 0;",
    );

    await expect(runMigrations(db.pool, dir)).rejects.toThrow(
      /0001_broken failed/,
    );

    const table = await db.pool.query<{ found: string | null }>(
      "SELECT to_regclass('should_not_exist')::text AS found",
    );
    expect(table.rows[0]?.found).toBeNull();

    const recorded = await db.pool.query("SELECT 1 FROM schema_migrations");
    expect(recorded.rowCount).toBe(0);
  });
});

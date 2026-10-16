import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
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

  it("applies pending migrations once and creates the expected tables", async () => {
    expect(await runMigrations(db.pool, MIGRATIONS_DIR)).toEqual(["0001"]);

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

  it("is idempotent: a second run applies nothing", async () => {
    expect(await runMigrations(db.pool, MIGRATIONS_DIR)).toEqual([]);
  });

  it("refuses to continue if an applied migration was edited", async () => {
    await db.pool.query(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001'",
    );
    try {
      await expect(runMigrations(db.pool, MIGRATIONS_DIR)).rejects.toThrow(
        /checksum/i,
      );
    } finally {
      // Put the real checksum back by recording it again from the file on disk.
      await db.pool.query(
        "DELETE FROM schema_migrations WHERE version = '0001'",
      );
    }
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

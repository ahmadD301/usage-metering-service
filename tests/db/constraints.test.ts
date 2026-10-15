import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_PLAN_ID,
  DEFAULT_USER_PLAN_ID,
} from "../../src/db/predefined-plans.js";
import { exactlyOne } from "../../src/db/client.js";
import { createTestDb, insertAccount, insertUser, type TestDb } from "../helpers/test-db.js";

const FK_VIOLATION = { code: "23503" };
const UNIQUE_VIOLATION = { code: "23505" };
const CHECK_VIOLATION = { code: "23514" };

describe("schema constraints", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  describe("plan scope", () => {
    it("rejects an account that uses a user-scope plan", async () => {
      await expect(
        db.pool.query("INSERT INTO accounts (name, plan_id) VALUES ('bad', $1)", [
          DEFAULT_USER_PLAN_ID,
        ]),
      ).rejects.toMatchObject(FK_VIOLATION);
    });

    it("rejects a user that uses an account-scope plan", async () => {
      const accountId = await insertAccount(db.pool, "scope-check");
      await expect(
        db.pool.query("INSERT INTO users (account_id, external_id, plan_id) VALUES ($1, 'u', $2)", [
          accountId,
          DEFAULT_ACCOUNT_PLAN_ID,
        ]),
      ).rejects.toMatchObject(FK_VIOLATION);
    });
  });

  describe("users", () => {
    it("keeps external ids unique per account but reusable across accounts", async () => {
      const a = await insertAccount(db.pool, "users-a");
      const b = await insertAccount(db.pool, "users-b");
      await insertUser(db.pool, a, "alice");
      await expect(insertUser(db.pool, a, "alice")).rejects.toMatchObject(UNIQUE_VIOLATION);
      await expect(insertUser(db.pool, b, "alice")).resolves.toEqual(expect.any(String));
    });
  });

  describe("predefined plans are read-only", () => {
    it("blocks updating and deleting a predefined plan", async () => {
      await expect(
        db.pool.query("UPDATE plans SET name = 'Hacked' WHERE id = $1", [DEFAULT_ACCOUNT_PLAN_ID]),
      ).rejects.toMatchObject(CHECK_VIOLATION);
      await expect(
        db.pool.query("DELETE FROM plans WHERE id = $1", [DEFAULT_ACCOUNT_PLAN_ID]),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    });

    it("blocks changing or deleting the rules of a predefined plan", async () => {
      await expect(
        db.pool.query("UPDATE plan_rules SET limit_value = 1 WHERE plan_id = $1", [
          DEFAULT_USER_PLAN_ID,
        ]),
      ).rejects.toMatchObject(CHECK_VIOLATION);
      await expect(
        db.pool.query("DELETE FROM plan_rules WHERE plan_id = $1", [DEFAULT_USER_PLAN_ID]),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    });

    it("still allows an account to edit its own custom plan", async () => {
      const accountId = await insertAccount(db.pool, "custom-plans");
      const plan = await db.pool.query<{ id: string }>(
        "INSERT INTO plans (scope, name, owner_account_id) VALUES ('user', 'Custom', $1) RETURNING id",
        [accountId],
      );
      const planId = exactlyOne(plan.rows, "custom plan").id;
      await db.pool.query(
        "INSERT INTO plan_rules (plan_id, kind, limit_value) VALUES ($1, 'monthly_allowance', 50)",
        [planId],
      );

      const updated = await db.pool.query(
        "UPDATE plan_rules SET limit_value = 75 WHERE plan_id = $1",
        [planId],
      );
      expect(updated.rowCount).toBe(1);
    });

    it("rejects duplicate rule kinds and negative limits", async () => {
      const accountId = await insertAccount(db.pool, "rule-checks");
      const plan = await db.pool.query<{ id: string }>(
        "INSERT INTO plans (scope, name, owner_account_id) VALUES ('user', 'Rules', $1) RETURNING id",
        [accountId],
      );
      const planId = exactlyOne(plan.rows, "plan").id;
      await db.pool.query(
        "INSERT INTO plan_rules (plan_id, kind, limit_value) VALUES ($1, 'max_per_request', 5)",
        [planId],
      );
      await expect(
        db.pool.query(
          "INSERT INTO plan_rules (plan_id, kind, limit_value) VALUES ($1, 'max_per_request', 6)",
          [planId],
        ),
      ).rejects.toMatchObject(UNIQUE_VIOLATION);
      await expect(
        db.pool.query(
          "INSERT INTO plan_rules (plan_id, kind, limit_value) VALUES ($1, 'daily_allowance', -1)",
          [planId],
        ),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    });
  });

  describe("usage counters", () => {
    it("rejects negative usage and a month that does not start on day 1", async () => {
      const accountId = await insertAccount(db.pool, "usage-checks");
      await expect(
        db.pool.query(
          "INSERT INTO account_usage (account_id, period_kind, period_start, units_used) VALUES ($1, 'month', '2026-10-01', -1)",
          [accountId],
        ),
      ).rejects.toMatchObject(CHECK_VIOLATION);
      await expect(
        db.pool.query(
          "INSERT INTO account_usage (account_id, period_kind, period_start, units_used) VALUES ($1, 'month', '2026-10-15', 5)",
          [accountId],
        ),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    });

    it("accepts valid month and day rows and keeps one row per period", async () => {
      const accountId = await insertAccount(db.pool, "usage-ok");
      await db.pool.query(
        "INSERT INTO account_usage (account_id, period_kind, period_start, units_used) VALUES ($1, 'month', '2026-10-01', 5), ($1, 'day', '2026-10-15', 5)",
        [accountId],
      );
      await expect(
        db.pool.query(
          "INSERT INTO account_usage (account_id, period_kind, period_start, units_used) VALUES ($1, 'month', '2026-10-01', 1)",
          [accountId],
        ),
      ).rejects.toMatchObject(UNIQUE_VIOLATION);
    });
  });

  describe("requests (history and idempotency)", () => {
    const insertRequest = (
      accountId: string,
      userId: string,
      requestId: string,
    ): Promise<unknown> =>
      db.pool.query(
        `INSERT INTO requests (account_id, user_id, request_id, units, fingerprint, outcome, decision)
         VALUES ($1, $2, $3, 10, 'fp', 'accepted', '{}'::jsonb)`,
        [accountId, userId, requestId],
      );

    it("keeps request ids unique per account but reusable across accounts", async () => {
      const a = await insertAccount(db.pool, "req-a");
      const b = await insertAccount(db.pool, "req-b");
      const userA = await insertUser(db.pool, a, "u");
      const userB = await insertUser(db.pool, b, "u");

      await insertRequest(a, userA, "r-1");
      await expect(insertRequest(a, userA, "r-1")).rejects.toMatchObject(UNIQUE_VIOLATION);
      await expect(insertRequest(b, userB, "r-1")).resolves.toBeDefined();
    });

    it("cannot record a request for a user of a different account", async () => {
      const a = await insertAccount(db.pool, "iso-a");
      const b = await insertAccount(db.pool, "iso-b");
      const userOfB = await insertUser(db.pool, b, "bob");
      await expect(insertRequest(a, userOfB, "cross")).rejects.toMatchObject(FK_VIOLATION);
    });
  });

  describe("api keys", () => {
    it("requires a 64-character hex hash and keeps hashes unique", async () => {
      const accountId = await insertAccount(db.pool, "keys");
      const hash = "a".repeat(64);
      await db.pool.query(
        "INSERT INTO api_keys (account_id, key_prefix, key_hash) VALUES ($1, 'mk_abcd', $2)",
        [accountId, hash],
      );
      await expect(
        db.pool.query(
          "INSERT INTO api_keys (account_id, key_prefix, key_hash) VALUES ($1, 'mk_abcd', $2)",
          [accountId, hash],
        ),
      ).rejects.toMatchObject(UNIQUE_VIOLATION);
      await expect(
        db.pool.query(
          "INSERT INTO api_keys (account_id, key_prefix, key_hash) VALUES ($1, 'mk_abcd', 'not-a-hash')",
          [accountId],
        ),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    });
  });
});
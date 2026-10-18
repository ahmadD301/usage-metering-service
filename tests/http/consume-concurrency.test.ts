import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTotals } from "../helpers/consistency.js";
import {
  asAccount,
  createAccount,
  createTestApp,
  type PlanBody,
  type TestApp,
} from "../helpers/test-app.js";

type Api = ReturnType<typeof asAccount>;
type Call = { userId: string; requestId: string; units: number };
type Decision = {
  accepted: boolean;
  replayed: boolean;
  reason: { primary: { level: string; rule: string } } | null;
};

const FIXED_NOW = new Date("2026-10-16T10:00:00.000Z");
const MONTH = "2026-10-01";
const TIMEOUT = 30_000;

describe("consume under concurrency", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ clock: () => FIXED_NOW });
  });
  afterAll(async () => {
    await t.close();
  });

  const createPlan = async (
    api: Api,
    scope: "account" | "user",
    rules: { kind: string; limit: number }[],
  ): Promise<string> => {
    const response = await api.post("/plans", {
      name: `${scope} plan`,
      scope,
      rules,
    });
    return response.json<{ plan: PlanBody }>().plan.id;
  };

  /** An account with custom limits and users u0..u{n-1}, all on the same user plan. */
  const setup = async (
    name: string,
    limits: {
      accountMonthly: number;
      userMonthly: number;
      perRequest: number;
      users: number;
    },
  ) => {
    const account = await createAccount(t.app, name);
    const api = asAccount(t.app, account.apiKey);
    const accountPlanId = await createPlan(api, "account", [
      { kind: "monthly_allowance", limit: limits.accountMonthly },
      { kind: "max_per_request", limit: limits.perRequest },
    ]);
    await api.put("/account/plan", { planId: accountPlanId });
    const userPlanId = await createPlan(api, "user", [
      { kind: "monthly_allowance", limit: limits.userMonthly },
      { kind: "max_per_request", limit: limits.perRequest },
    ]);
    for (let i = 0; i < limits.users; i += 1) {
      await api.post("/users", {
        externalId: `u${String(i)}`,
        planId: userPlanId,
      });
    }
    return { api, accountId: account.id };
  };

  const fire = async (
    api: Api,
    calls: readonly Call[],
  ): Promise<Decision[]> => {
    const responses = await Promise.all(
      calls.map((call) => api.post("/consume", call)),
    );
    return responses.map((response) => {
      expect(response.statusCode).toBe(200);
      return response.json<Decision>();
    });
  };

  const calls = (
    prefix: string,
    count: number,
    users: number,
    units: number,
  ): Call[] =>
    Array.from({ length: count }, (_, i) => ({
      userId: `u${String(i % users)}`,
      requestId: `${prefix}${String(i)}`,
      units,
    }));

  it(
    "never overspends a shared account allowance, even across accounts running at once",
    async () => {
      const a = await setup("Conc A", {
        accountMonthly: 100,
        userMonthly: 10_000,
        perRequest: 10,
        users: 20,
      });
      const b = await setup("Conc B", {
        accountMonthly: 50,
        userMonthly: 10_000,
        perRequest: 10,
        users: 10,
      });

      const [resultsA, resultsB] = await Promise.all([
        fire(a.api, calls("a", 60, 20, 10)),
        fire(b.api, calls("b", 30, 10, 10)),
      ]);

      expect(resultsA.filter((result) => result.accepted)).toHaveLength(10);
      expect(resultsB.filter((result) => result.accepted)).toHaveLength(5);
      for (const rejected of [...resultsA, ...resultsB].filter(
        (result) => !result.accepted,
      )) {
        // FIX: the violation carries more fields (limit, used, ...), so match only what we assert.
        expect(rejected.reason?.primary).toMatchObject({
          level: "account",
          rule: "monthly_allowance",
        });
      }

      expect(await readTotals(t.db.pool, a.accountId, MONTH)).toEqual({
        accountTotal: 100,
        usersTotal: 100,
        acceptedTotal: 100,
        requestCount: 60,
      });
      expect(await readTotals(t.db.pool, b.accountId, MONTH)).toEqual({
        accountTotal: 50,
        usersTotal: 50,
        acceptedTotal: 50,
        requestCount: 30,
      });
    },
    TIMEOUT,
  );

  it(
    "never overspends one user's allowance when the same user is hit concurrently",
    async () => {
      const hot = await setup("Hot user", {
        accountMonthly: 10_000,
        userMonthly: 100,
        perRequest: 20,
        users: 1,
      });

      const results = await fire(hot.api, calls("h", 40, 1, 20));

      expect(results.filter((result) => result.accepted)).toHaveLength(5);
      for (const rejected of results.filter((result) => !result.accepted)) {
        // FIX: toMatchObject instead of toEqual, same reason as above.
        expect(rejected.reason?.primary).toMatchObject({
          level: "user",
          rule: "monthly_allowance",
        });
      }
      expect(await readTotals(t.db.pool, hot.accountId, MONTH)).toEqual({
        accountTotal: 100,
        usersTotal: 100,
        acceptedTotal: 100,
        requestCount: 40,
      });
    },
    TIMEOUT,
  );

  it(
    "counts a request once when the same request id arrives many times at once",
    async () => {
      const dup = await setup("Dup", {
        accountMonthly: 1_000,
        userMonthly: 1_000,
        perRequest: 10,
        users: 1,
      });
      const sameCall: Call = { userId: "u0", requestId: "same", units: 10 };

      const results = await fire(
        dup.api,
        Array.from({ length: 25 }, () => sameCall),
      );

      const originals = results.filter((result) => !result.replayed);
      const replays = results.filter((result) => result.replayed);
      expect(originals).toHaveLength(1);
      expect(replays).toHaveLength(24);

      for (const replay of replays) {
        expect(replay).toEqual({ ...originals[0], replayed: true });
      }

      expect(await readTotals(t.db.pool, dup.accountId, MONTH)).toEqual({
        accountTotal: 10,
        usersTotal: 10,
        acceptedTotal: 10,
        requestCount: 1,
      });
    },
    TIMEOUT,
  );
});

import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PREMIUM_PLAN_ID } from "../../src/db/predefined-plans.js";
import {
  asAccount,
  createAccount,
  createTestApp,
  mutableClock,
  type ErrorBody,
  type PlanBody,
  type TestApp,
} from "../helpers/test-app.js";

type Api = ReturnType<typeof asAccount>;
type Remaining = {
  monthlyAllowance: number | null;
  dailyAllowance: number | null;
  maxPerRequest: number | null;
};
type Violation = {
  level: "account" | "user";
  rule: string;
  limit: number;
  used: number | null;
  remaining: number;
  requested: number;
};
type ConsumeBody = {
  requestId: string;
  userId: string;
  units: number;
  accepted: boolean;
  replayed: boolean;
  reason: { primary: Violation; violations: Violation[] } | null;
  plans: { account: { name: string }; user: { name: string } };
  remaining: { account: Remaining; user: Remaining };
  decidedAt: string;
};
type UsageView = {
  month: string;
  isCurrentMonth: boolean;
  plan: { id: string; name: string };
  consumed: { month: number; today: number | null };
  remaining: Remaining | null;
};
type HistoryBody = {
  requests: (Omit<ConsumeBody, "replayed"> & { createdAt: string })[];
  nextCursor: string | null;
};

const OCT_16 = "2026-10-16T10:00:00.000Z";

describe("consume", () => {
  let t: TestApp;
  const clock = mutableClock(OCT_16);
  let accountCounter = 0;

  beforeAll(async () => {
    t = await createTestApp({ clock: clock.now });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    clock.set(OCT_16);
  });

  // ---- helpers ----

  const newAccount = async (): Promise<Api> => {
    accountCounter += 1;
    const account = await createAccount(
      t.app,
      `Acme ${String(accountCounter)}`,
    );
    return asAccount(t.app, account.apiKey);
  };

  const addUser = (api: Api, externalId: string, planId?: string) =>
    api.post(
      "/users",
      planId === undefined ? { externalId } : { externalId, planId },
    );

  const addPlan = async (
    api: Api,
    name: string,
    scope: "account" | "user",
    rules: { kind: string; limit: number }[],
  ): Promise<PlanBody> => {
    const response = await api.post("/plans", { name, scope, rules });
    expect(response.statusCode).toBe(201);
    return response.json<{ plan: PlanBody }>().plan;
  };

  const consumeOk = async (
    api: Api,
    body: { userId: string; requestId: string; units: number },
  ): Promise<ConsumeBody> => {
    const response = await api.post("/consume", body);
    expect(response.statusCode).toBe(200);
    return response.json<ConsumeBody>();
  };

  const userUsage = async (api: Api, externalId: string, query = "") =>
    (await api.get(`/users/${externalId}/usage${query}`)).json<{
      user: UsageView & { userId: string };
      account: UsageView;
    }>();

  const accountUsage = async (api: Api, query = "") =>
    (await api.get(`/usage${query}`)).json<{ account: UsageView }>();

  const history = async (api: Api, query = ""): Promise<HistoryBody> =>
    (await api.get(`/history${query}`)).json<HistoryBody>();

  // ---- the brief's core scenarios ----

  describe("decisions", () => {
    it("accepts a request that fits both plans and returns the remaining allowances", async () => {
      const api = await newAccount();
      await addUser(api, "alice");

      const body = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 10,
      });

      expect(body).toMatchObject({
        requestId: "r1",
        userId: "alice",
        units: 10,
        accepted: true,
        replayed: false,
        reason: null,
      });
      expect(body.plans).toMatchObject({
        account: { name: "Starter" },
        user: { name: "Basic" },
      });
      expect(body.remaining.user).toEqual({
        monthlyAllowance: 990,
        dailyAllowance: null,
        maxPerRequest: 20,
      });
      expect(body.remaining.account).toEqual({
        monthlyAllowance: 9_990,
        dailyAllowance: null,
        maxPerRequest: 100,
      });
    });

    it("rejects because of the user's per-request limit and consumes nothing", async () => {
      const api = await newAccount();
      await addUser(api, "alice");

      const body = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 25,
      });

      expect(body.accepted).toBe(false);
      expect(body.reason?.primary).toEqual({
        level: "user",
        rule: "max_per_request",
        limit: 20,
        used: null,
        remaining: 20,
        requested: 25,
      });
      expect(body.reason?.violations).toHaveLength(1);

      const usage = await userUsage(api, "alice");
      expect(usage.user.consumed.month).toBe(0);
      expect(usage.account.consumed.month).toBe(0);
    });

    it("rejects because of the shared account allowance even when the user has plenty", async () => {
      const api = await newAccount();
      const tiny = await addPlan(api, "Tiny", "account", [
        { kind: "monthly_allowance", limit: 25 },
        { kind: "max_per_request", limit: 100 },
      ]);
      expect(
        (await api.put("/account/plan", { planId: tiny.id })).statusCode,
      ).toBe(200);
      await addUser(api, "alice");
      await addUser(api, "bob", PREMIUM_PLAN_ID);

      const first = await consumeOk(api, {
        userId: "bob",
        requestId: "r1",
        units: 20,
      });
      expect(first.accepted).toBe(true);
      expect(first.remaining.account.monthlyAllowance).toBe(5);

      const second = await consumeOk(api, {
        userId: "alice",
        requestId: "r2",
        units: 10,
      });
      expect(second.accepted).toBe(false);
      expect(second.reason?.primary).toEqual({
        level: "account",
        rule: "monthly_allowance",
        limit: 25,
        used: 20,
        remaining: 5,
        requested: 10,
      });
      expect(second.reason?.violations).toHaveLength(1);
    });

    it("counts the same units at the user level and the account level", async () => {
      const api = await newAccount();
      await addUser(api, "alice");
      await addUser(api, "bob");
      await consumeOk(api, { userId: "alice", requestId: "r1", units: 10 });
      await consumeOk(api, { userId: "bob", requestId: "r2", units: 15 });

      expect((await userUsage(api, "alice")).user.consumed.month).toBe(10);
      expect((await userUsage(api, "bob")).user.consumed.month).toBe(15);
      expect((await accountUsage(api)).account.consumed.month).toBe(25);
    });

    it("enforces a daily allowance, which resets on the next UTC day", async () => {
      const api = await newAccount();
      const daily = await addPlan(api, "Daily", "user", [
        { kind: "monthly_allowance", limit: 1_000 },
        { kind: "daily_allowance", limit: 30 },
        { kind: "max_per_request", limit: 20 },
      ]);
      await addUser(api, "alice", daily.id);

      const first = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 20,
      });
      expect(first.accepted).toBe(true);
      expect(first.remaining.user.dailyAllowance).toBe(10);

      const second = await consumeOk(api, {
        userId: "alice",
        requestId: "r2",
        units: 20,
      });
      expect(second.accepted).toBe(false);
      expect(second.reason?.primary).toEqual({
        level: "user",
        rule: "daily_allowance",
        limit: 30,
        used: 20,
        remaining: 10,
        requested: 20,
      });

      clock.set("2026-10-17T00:00:00.000Z");
      const third = await consumeOk(api, {
        userId: "alice",
        requestId: "r3",
        units: 20,
      });
      expect(third.accepted).toBe(true);
      expect(third.remaining.user.dailyAllowance).toBe(10);
      expect(third.remaining.user.monthlyAllowance).toBe(960);
    });
  });

  describe("month rollover", () => {
    it("starts each UTC month at zero and keeps previous months queryable", async () => {
      const api = await newAccount();
      const small = await addPlan(api, "Small", "user", [
        { kind: "monthly_allowance", limit: 20 },
        { kind: "max_per_request", limit: 20 },
      ]);
      await addUser(api, "alice", small.id);

      clock.set("2026-10-31T23:59:59.999Z");
      const used = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 20,
      });
      expect(used.accepted).toBe(true);
      expect(used.remaining.user.monthlyAllowance).toBe(0);

      const blocked = await consumeOk(api, {
        userId: "alice",
        requestId: "r2",
        units: 1,
      });
      expect(blocked.accepted).toBe(false);
      expect(blocked.reason?.primary).toMatchObject({
        level: "user",
        rule: "monthly_allowance",
        used: 20,
        remaining: 0,
      });

      clock.set("2026-11-01T00:00:00.000Z");
      const fresh = await consumeOk(api, {
        userId: "alice",
        requestId: "r3",
        units: 1,
      });
      expect(fresh.accepted).toBe(true);
      expect(fresh.remaining.user.monthlyAllowance).toBe(19);

      const october = await userUsage(api, "alice", "?month=2026-10");
      expect(october.user).toMatchObject({
        month: "2026-10",
        isCurrentMonth: false,
        consumed: { month: 20, today: null },
        remaining: null,
      });
      expect(october.account.consumed.month).toBe(20);

      const november = await userUsage(api, "alice");
      expect(november.user.consumed.month).toBe(1);
      expect(november.user.isCurrentMonth).toBe(true);
    });
  });

  // ---- retries ----

  describe("idempotency", () => {
    it("replays the original decision and counts the units only once", async () => {
      const api = await newAccount();
      await addUser(api, "alice");

      const first = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 10,
      });
      const second = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 10,
      });

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect({ ...second, replayed: false }).toEqual(first);
      expect((await userUsage(api, "alice")).user.consumed.month).toBe(10);
      expect((await history(api)).requests).toHaveLength(1);
    });

    it("replays a rejection even after the plan was upgraded, and a new request id is evaluated fresh", async () => {
      const api = await newAccount();
      await addUser(api, "alice");

      const rejected = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 25,
      });
      expect(rejected.accepted).toBe(false);

      expect(
        (await api.put("/users/alice/plan", { planId: PREMIUM_PLAN_ID }))
          .statusCode,
      ).toBe(200);

      const retry = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 25,
      });
      expect(retry.replayed).toBe(true);
      expect(retry.accepted).toBe(false);

      const fresh = await consumeOk(api, {
        userId: "alice",
        requestId: "r2",
        units: 25,
      });
      expect(fresh.accepted).toBe(true);
    });

    it("returns 409 when a request id is reused with a different payload", async () => {
      const api = await newAccount();
      await addUser(api, "alice");
      await addUser(api, "bob");
      await consumeOk(api, { userId: "alice", requestId: "r1", units: 10 });

      const otherUnits = await api.post("/consume", {
        userId: "alice",
        requestId: "r1",
        units: 11,
      });
      expect(otherUnits.statusCode).toBe(409);
      expect(otherUnits.json<ErrorBody>().error.code).toBe(
        "idempotency_conflict",
      );

      const otherUser = await api.post("/consume", {
        userId: "bob",
        requestId: "r1",
        units: 10,
      });
      expect(otherUser.statusCode).toBe(409);

      expect((await userUsage(api, "alice")).user.consumed.month).toBe(10);
    });

    it("scopes request ids per account", async () => {
      const a = await newAccount();
      const b = await newAccount();
      await addUser(a, "alice");
      await addUser(b, "alice");

      const first = await consumeOk(a, {
        userId: "alice",
        requestId: "same-id",
        units: 10,
      });
      const second = await consumeOk(b, {
        userId: "alice",
        requestId: "same-id",
        units: 10,
      });
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(false);
    });
  });

  // ---- plan changes ----

  describe("plan changes", () => {
    it("applies a raised limit to new requests and preserves earlier history", async () => {
      const api = await newAccount();
      const strict = await addPlan(api, "Strict", "user", [
        { kind: "max_per_request", limit: 5 },
      ]);
      await addUser(api, "alice", strict.id);

      const before = await consumeOk(api, {
        userId: "alice",
        requestId: "r1",
        units: 10,
      });
      expect(before.accepted).toBe(false);
      expect(before.reason?.primary.limit).toBe(5);

      const updated = await api.put(`/plans/${strict.id}`, {
        name: "Strict",
        rules: [{ kind: "max_per_request", limit: 50 }],
      });
      expect(updated.statusCode).toBe(200);

      const after = await consumeOk(api, {
        userId: "alice",
        requestId: "r2",
        units: 10,
      });
      expect(after.accepted).toBe(true);

      const entries = (await history(api)).requests;
      expect(entries.map((entry) => [entry.requestId, entry.accepted])).toEqual(
        [
          ["r2", true],
          ["r1", false],
        ],
      );
      expect(entries[1]?.reason?.primary.limit).toBe(5);
    });

    it("keeps consumed units when a user switches plans", async () => {
      const api = await newAccount();
      await addUser(api, "alice");
      await consumeOk(api, { userId: "alice", requestId: "r1", units: 20 });

      expect(
        (await api.put("/users/alice/plan", { planId: PREMIUM_PLAN_ID }))
          .statusCode,
      ).toBe(200);

      const usage = await userUsage(api, "alice");
      expect(usage.user.plan.name).toBe("Premium");
      expect(usage.user.consumed.month).toBe(20);
      expect(usage.user.remaining?.monthlyAllowance).toBe(9_980);

      const next = await consumeOk(api, {
        userId: "alice",
        requestId: "r2",
        units: 100,
      });
      expect(next.accepted).toBe(true);
      expect(next.remaining.user.monthlyAllowance).toBe(9_880);
    });

    it("shows zero remaining when the allowance drops below usage, and recovers when raised", async () => {
      const api = await newAccount();
      const flexible = await addPlan(api, "Flexible", "user", [
        { kind: "monthly_allowance", limit: 100 },
        { kind: "max_per_request", limit: 100 },
      ]);
      await addUser(api, "alice", flexible.id);
      await consumeOk(api, { userId: "alice", requestId: "r1", units: 80 });

      await api.put(`/plans/${flexible.id}`, {
        name: "Flexible",
        rules: [
          { kind: "monthly_allowance", limit: 50 },
          { kind: "max_per_request", limit: 100 },
        ],
      });

      const blocked = await consumeOk(api, {
        userId: "alice",
        requestId: "r2",
        units: 1,
      });
      expect(blocked.accepted).toBe(false);
      expect(blocked.reason?.primary).toEqual({
        level: "user",
        rule: "monthly_allowance",
        limit: 50,
        used: 80,
        remaining: 0,
        requested: 1,
      });
      const usage = await userUsage(api, "alice");
      expect(usage.user.remaining?.monthlyAllowance).toBe(0);
      expect(usage.user.consumed.month).toBe(80);

      await api.put(`/plans/${flexible.id}`, {
        name: "Flexible",
        rules: [
          { kind: "monthly_allowance", limit: 200 },
          { kind: "max_per_request", limit: 100 },
        ],
      });
      const recovered = await consumeOk(api, {
        userId: "alice",
        requestId: "r3",
        units: 1,
      });
      expect(recovered.accepted).toBe(true);
      expect(recovered.remaining.user.monthlyAllowance).toBe(119);
    });
  });

  // ---- input, auth and isolation ----

  describe("validation and errors", () => {
    it.each([
      ["zero units", { userId: "alice", requestId: "r", units: 0 }],
      ["negative units", { userId: "alice", requestId: "r", units: -5 }],
      ["fractional units", { userId: "alice", requestId: "r", units: 1.5 }],
      ["units as a string", { userId: "alice", requestId: "r", units: "10" }],
      [
        "units above the maximum",
        { userId: "alice", requestId: "r", units: 1_000_000_001 },
      ],
      ["missing units", { userId: "alice", requestId: "r" }],
      ["empty request id", { userId: "alice", requestId: "", units: 1 }],
      ["missing user id", { requestId: "r", units: 1 }],
    ])("rejects an invalid body with 400: %s", async (_label, payload) => {
      const api = await newAccount();
      await addUser(api, "alice");
      const response = await api.post("/consume", payload);
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe("validation_error");
      expect((await history(api)).requests).toHaveLength(0);
    });

    it("returns 404 for an unknown user and records nothing", async () => {
      const api = await newAccount();
      const response = await api.post("/consume", {
        userId: "ghost",
        requestId: "r1",
        units: 1,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorBody>().error.code).toBe("user_not_found");
      expect((await history(api)).requests).toHaveLength(0);
    });

    it("requires a valid API key on every new route", async () => {
      const payload = { userId: "alice", requestId: "r1", units: 1 };
      const missing = await t.app.inject({
        method: "POST",
        url: "/consume",
        payload,
      });
      expect(missing.statusCode).toBe(401);
      expect(missing.json<ErrorBody>().error.code).toBe("missing_api_key");

      const invalid = await asAccount(t.app, "mk_00000000_notarealkey").post(
        "/consume",
        payload,
      );
      expect(invalid.statusCode).toBe(401);
      expect(invalid.json<ErrorBody>().error.code).toBe("invalid_api_key");

      for (const url of ["/usage", "/history", "/users/alice/usage"]) {
        expect((await t.app.inject({ method: "GET", url })).statusCode).toBe(
          401,
        );
      }
    });
  });

  describe("account isolation", () => {
    it("does not let one account consume for, see, or count against another's users", async () => {
      const a = await newAccount();
      const b = await newAccount();
      await addUser(a, "alice");
      await consumeOk(a, { userId: "alice", requestId: "r1", units: 10 });

      const crossAccount = await b.post("/consume", {
        userId: "alice",
        requestId: "x1",
        units: 5,
      });
      expect(crossAccount.statusCode).toBe(404);
      expect(crossAccount.json<ErrorBody>().error.code).toBe("user_not_found");

      expect((await b.get("/users/alice/usage")).statusCode).toBe(404);
      expect((await history(b)).requests).toEqual([]);
      expect((await accountUsage(b)).account.consumed.month).toBe(0);
      expect((await accountUsage(a)).account.consumed.month).toBe(10);
    });
  });

  // ---- usage and history ----

  describe("usage endpoints", () => {
    it("returns consumed and remaining for the account and its users", async () => {
      const api = await newAccount();
      await addUser(api, "alice");
      await addUser(api, "bob");
      await consumeOk(api, { userId: "alice", requestId: "r1", units: 10 });
      await consumeOk(api, { userId: "bob", requestId: "r2", units: 20 });

      const { account } = await accountUsage(api);
      expect(account).toMatchObject({
        month: "2026-10",
        isCurrentMonth: true,
        plan: { name: "Starter" },
        consumed: { month: 30, today: 30 },
      });
      expect(account.remaining).toEqual({
        monthlyAllowance: 9_970,
        dailyAllowance: null,
        maxPerRequest: 100,
      });

      const alice = await userUsage(api, "alice");
      expect(alice.user.consumed).toEqual({ month: 10, today: 10 });
      expect(alice.user.remaining?.monthlyAllowance).toBe(990);
      expect(alice.account.consumed.month).toBe(30);
    });

    it("shows zero for an empty past month and rejects a malformed month", async () => {
      const api = await newAccount();
      const { account } = await accountUsage(api, "?month=2026-09");
      expect(account).toMatchObject({ isCurrentMonth: false, remaining: null });
      expect(account.consumed).toEqual({ month: 0, today: null });

      const bad = await api.get("/usage?month=2026-13");
      expect(bad.statusCode).toBe(400);
      expect(bad.json<ErrorBody>().error.code).toBe("validation_error");
    });
  });

  describe("history", () => {
    const seed = async (api: Api): Promise<void> => {
      await addUser(api, "alice");
      await addUser(api, "bob");
      await consumeOk(api, { userId: "alice", requestId: "r1", units: 10 });
      await consumeOk(api, { userId: "bob", requestId: "r2", units: 10 });
      await consumeOk(api, { userId: "alice", requestId: "r3", units: 25 }); // rejected
      await consumeOk(api, { userId: "bob", requestId: "r4", units: 10 });
      await consumeOk(api, { userId: "alice", requestId: "r5", units: 10 });
    };
    const ids = (page: HistoryBody): string[] =>
      page.requests.map((entry) => entry.requestId);

    it("pages newest first with a cursor and no gaps or duplicates", async () => {
      const api = await newAccount();
      await seed(api);

      const page1 = await history(api, "?limit=2");
      expect(ids(page1)).toEqual(["r5", "r4"]);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await history(
        api,
        `?limit=2&cursor=${page1.nextCursor ?? ""}`,
      );
      expect(ids(page2)).toEqual(["r3", "r2"]);

      const page3 = await history(
        api,
        `?limit=2&cursor=${page2.nextCursor ?? ""}`,
      );
      expect(ids(page3)).toEqual(["r1"]);
      expect(page3.nextCursor).toBeNull();
    });

    it("filters by outcome, user and month", async () => {
      const api = await newAccount();
      await seed(api);

      expect(ids(await history(api, "?outcome=rejected"))).toEqual(["r3"]);
      expect(ids(await history(api, "?userId=bob"))).toEqual(["r4", "r2"]);
      expect((await history(api, "?month=2026-10")).requests).toHaveLength(5);
      expect((await history(api, "?month=2026-09")).requests).toHaveLength(0);
    });

    it("includes the decision details for each entry", async () => {
      const api = await newAccount();
      await seed(api);
      const rejected = (await history(api, "?outcome=rejected")).requests[0];
      expect(rejected).toMatchObject({
        requestId: "r3",
        userId: "alice",
        units: 25,
        accepted: false,
      });
      expect(rejected?.reason?.primary.rule).toBe("max_per_request");
      expect(typeof rejected?.createdAt).toBe("string");
    });

    it("rejects an invalid cursor and an invalid limit with 400", async () => {
      const api = await newAccount();
      expect((await api.get("/history?cursor=garbage")).statusCode).toBe(400);
      expect((await api.get("/history?limit=0")).statusCode).toBe(400);
    });
  });
});

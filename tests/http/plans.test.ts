import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTER_PLAN_ID } from "../../src/db/predefined-plans.js";
import {
  asAccount,
  createAccount,
  createTestApp,
  type ErrorBody,
  type PlanBody,
  type TestApp,
} from "../helpers/test-app.js";

describe("plans", () => {
  let t: TestApp;
  let api: ReturnType<typeof asAccount>;

  beforeAll(async () => {
    t = await createTestApp();
    api = asAccount(t.app, (await createAccount(t.app, "Plans Co")).apiKey);
  });
  afterAll(async () => {
    await t.close();
  });

  it("lists the four predefined plans for a new account", async () => {
    const { plans } = (await api.get("/plans")).json<{ plans: PlanBody[] }>();
    expect(plans.map((plan) => plan.name).sort()).toEqual(["Basic", "Premium", "Pro", "Starter"]);
    expect(plans.every((plan) => plan.predefined)).toBe(true);
  });

  it("filters the list by scope", async () => {
    const { plans } = (await api.get("/plans?scope=user")).json<{ plans: PlanBody[] }>();
    expect(plans.every((plan) => plan.scope === "user")).toBe(true);
    expect(plans).toHaveLength(2);
  });

  it("creates a custom plan and shows it in the list and by id", async () => {
    const created = await api.post("/plans", {
      name: "Interns",
      scope: "user",
      rules: [
        { kind: "monthly_allowance", limit: 100 },
        { kind: "max_per_request", limit: 5 },
      ],
    });
    expect(created.statusCode).toBe(201);
    const { plan } = created.json<{ plan: PlanBody }>();
    expect(plan).toMatchObject({ name: "Interns", scope: "user", predefined: false });
    expect(plan.rules).toHaveLength(2);

    const list = (await api.get("/plans")).json<{ plans: PlanBody[] }>().plans;
    expect(list.map((p) => p.id)).toContain(plan.id);
    expect((await api.get(`/plans/${plan.id}`)).statusCode).toBe(200);
  });

  it("rejects a duplicate plan name within an account but allows it in another", async () => {
    const body = { name: "Same name", scope: "user", rules: [] };
    expect((await api.post("/plans", body)).statusCode).toBe(201);
    const duplicate = await api.post("/plans", body);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<ErrorBody>().error.code).toBe("plan_name_taken");

    const other = asAccount(t.app, (await createAccount(t.app, "Other Co")).apiKey);
    expect((await other.post("/plans", body)).statusCode).toBe(201);
  });

  it("keeps predefined plans read-only", async () => {
    const response = await api.put(`/plans/${STARTER_PLAN_ID}`, { name: "Hacked", rules: [] });
    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe("plan_read_only");

    const plan = (await api.get(`/plans/${STARTER_PLAN_ID}`)).json<{ plan: PlanBody }>().plan;
    expect(plan.name).toBe("Starter");
    expect(plan.rules).toHaveLength(2);
  });

  it("replaces a custom plan's rules and returns the new rules on the next read", async () => {
    const { plan } = (
      await api.post("/plans", {
        name: "Editable",
        scope: "user",
        rules: [{ kind: "monthly_allowance", limit: 50 }],
      })
    ).json<{ plan: PlanBody }>();

    const updated = await api.put(`/plans/${plan.id}`, {
      name: "Editable v2",
      rules: [
        { kind: "daily_allowance", limit: 10 },
        { kind: "max_per_request", limit: 3 },
      ],
    });
    expect(updated.statusCode).toBe(200);

    const fetched = (await api.get(`/plans/${plan.id}`)).json<{ plan: PlanBody }>().plan;
    expect(fetched.name).toBe("Editable v2");
    expect(fetched.rules).toHaveLength(2);
    expect(fetched.rules).toEqual(
      expect.arrayContaining([
        { kind: "daily_allowance", limit: 10 },
        { kind: "max_per_request", limit: 3 },
      ]),
    );
  });

  it("applies a custom plan update to every user sharing it", async () => {
    const { plan } = (
      await api.post("/plans", {
        name: "Shared",
        scope: "user",
        rules: [{ kind: "max_per_request", limit: 10 }],
      })
    ).json<{ plan: PlanBody }>();
    await api.post("/users", { externalId: "s1", planId: plan.id });
    await api.post("/users", { externalId: "s2", planId: plan.id });

    await api.put(`/plans/${plan.id}`, {
      name: "Shared",
      rules: [{ kind: "max_per_request", limit: 99 }],
    });

    for (const externalId of ["s1", "s2"]) {
      const effective = (await api.get(`/users/${externalId}/effective-plans`)).json<{
        user: { plan: PlanBody };
      }>();
      expect(effective.user.plan.rules).toEqual([{ kind: "max_per_request", limit: 99 }]);
    }
  });

  it("assigns a custom account plan to the account", async () => {
    const { plan } = (
      await api.post("/plans", {
        name: "Account custom",
        scope: "account",
        rules: [{ kind: "monthly_allowance", limit: 777 }],
      })
    ).json<{ plan: PlanBody }>();

    expect((await api.put("/account/plan", { planId: plan.id })).statusCode).toBe(200);
    const account = (await api.get("/account")).json<{ account: { plan: PlanBody } }>().account;
    expect(account.plan.id).toBe(plan.id);
  });

  it("enforces plan scope on assignment (422)", async () => {
    const userPlan = (
      await api.post("/plans", { name: "User scoped", scope: "user", rules: [] })
    ).json<{ plan: PlanBody }>().plan;
    const accountPlan = (
      await api.post("/plans", { name: "Account scoped", scope: "account", rules: [] })
    ).json<{ plan: PlanBody }>().plan;
    await api.post("/users", { externalId: "scope-user" });

    const toAccount = await api.put("/account/plan", { planId: userPlan.id });
    expect(toAccount.statusCode).toBe(422);
    expect(toAccount.json<ErrorBody>().error.code).toBe("plan_scope_mismatch");

    const toUser = await api.put("/users/scope-user/plan", { planId: accountPlan.id });
    expect(toUser.statusCode).toBe(422);
  });

  it.each([
    ["duplicate rule kinds", { name: "x", scope: "user", rules: [{ kind: "max_per_request", limit: 1 }, { kind: "max_per_request", limit: 2 }] }],
    ["negative limit", { name: "x", scope: "user", rules: [{ kind: "monthly_allowance", limit: -1 }] }],
    ["fractional limit", { name: "x", scope: "user", rules: [{ kind: "monthly_allowance", limit: 1.5 }] }],
    ["unknown rule kind", { name: "x", scope: "user", rules: [{ kind: "per_minute", limit: 1 }] }],
    ["unknown scope", { name: "x", scope: "team", rules: [] }],
    ["missing name", { scope: "user", rules: [] }],
  ])("rejects an invalid plan body: %s", async (_label, body) => {
    const response = await api.post("/plans", body);
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe("validation_error");
  });

  it("rejects a malformed plan id with 400", async () => {
    expect((await api.get("/plans/not-a-uuid")).statusCode).toBe(400);
  });
});
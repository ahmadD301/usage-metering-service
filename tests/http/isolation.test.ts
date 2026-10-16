import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAccount,
  createAccount,
  createTestApp,
  type ErrorBody,
  type PlanBody,
  type TestApp,
} from "../helpers/test-app.js";

describe("account isolation", () => {
  let t: TestApp;
  let a: ReturnType<typeof asAccount>;
  let b: ReturnType<typeof asAccount>;
  let customPlanId: string;

  beforeAll(async () => {
    t = await createTestApp();
    a = asAccount(t.app, (await createAccount(t.app, "Account A")).apiKey);
    b = asAccount(t.app, (await createAccount(t.app, "Account B")).apiKey);

    await a.post("/users", { externalId: "alice" });
    const plan = await a.post("/plans", {
      name: "A secret plan",
      scope: "user",
      rules: [{ kind: "max_per_request", limit: 5 }],
    });
    customPlanId = plan.json<{ plan: PlanBody }>().plan.id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("hides another account's users (404, same as a missing user)", async () => {
    const response = await b.get("/users/alice");
    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe("user_not_found");
    expect((await b.get("/users/alice/effective-plans")).statusCode).toBe(404);
  });

  it("does not let another account change a user's plan", async () => {
    const response = await b.put("/users/alice/plan", { planId: customPlanId });
    expect(response.statusCode).toBe(404);
  });

  it("does not list another account's users", async () => {
    const response = await b.get("/users");
    expect(response.json<{ users: unknown[] }>().users).toEqual([]);
  });

  it("allows the same externalId in two accounts, with separate users", async () => {
    const created = await b.post("/users", { externalId: "alice" });
    expect(created.statusCode).toBe(201);
    expect(
      (await a.get("/users")).json<{ users: unknown[] }>().users,
    ).toHaveLength(1);
  });

  it("hides another account's custom plan from lists, reads, updates and assignment", async () => {
    const list = (await b.get("/plans")).json<{ plans: PlanBody[] }>().plans;
    expect(list.map((plan) => plan.id)).not.toContain(customPlanId);

    expect((await b.get(`/plans/${customPlanId}`)).statusCode).toBe(404);
    expect(
      (await b.put(`/plans/${customPlanId}`, { name: "stolen", rules: [] }))
        .statusCode,
    ).toBe(404);

    await b.post("/users", { externalId: "bob" });
    const assign = await b.put("/users/bob/plan", { planId: customPlanId });
    expect(assign.statusCode).toBe(404);
    expect(assign.json<ErrorBody>().error.code).toBe("plan_not_found");
  });

  it("leaves the owner's plan untouched after the foreign attempts", async () => {
    const plan = (await a.get(`/plans/${customPlanId}`)).json<{
      plan: PlanBody;
    }>().plan;
    expect(plan.name).toBe("A secret plan");
    expect(plan.rules).toEqual([{ kind: "max_per_request", limit: 5 }]);
  });
});

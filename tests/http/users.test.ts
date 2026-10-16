import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PREMIUM_PLAN_ID,
  STARTER_PLAN_ID,
} from "../../src/db/predefined-plans.js";
import {
  asAccount,
  createAccount,
  createTestApp,
  type ErrorBody,
  type PlanBody,
  type TestApp,
} from "../helpers/test-app.js";

type UserBody = { externalId: string; plan: PlanBody };

describe("users", () => {
  let t: TestApp;
  let api: ReturnType<typeof asAccount>;

  beforeAll(async () => {
    t = await createTestApp();
    api = asAccount(t.app, (await createAccount(t.app, "Users Co")).apiKey);
  });
  afterAll(async () => {
    await t.close();
  });

  it("registers a user on the Basic plan by default", async () => {
    const response = await api.post("/users", { externalId: "alice" });
    expect(response.statusCode).toBe(201);
    const { user } = response.json<{ user: UserBody }>();
    expect(user.externalId).toBe("alice");
    expect(user.plan).toMatchObject({ name: "Basic", scope: "user" });
  });

  it("returns 409 for a duplicate externalId", async () => {
    await api.post("/users", { externalId: "dup" });
    const response = await api.post("/users", { externalId: "dup" });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe("user_already_exists");
  });

  it("rejects an account-scope plan for a user with 422", async () => {
    const response = await api.post("/users", {
      externalId: "wrong",
      planId: STARTER_PLAN_ID,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.code).toBe("plan_scope_mismatch");
  });

  it("rejects an unknown plan with 404 and a bad body with 400", async () => {
    const unknown = await api.post("/users", {
      externalId: "ghost",
      planId: "11111111-1111-4111-8111-111111111111",
    });
    expect(unknown.statusCode).toBe(404);

    const invalid = await api.post("/users", { externalId: "" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<ErrorBody>().error.code).toBe("validation_error");
  });

  it("returns 404 for an unknown user", async () => {
    const response = await api.get("/users/nobody");
    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe("user_not_found");
  });

  it("switches a user's plan", async () => {
    await api.post("/users", { externalId: "switcher" });
    const switched = await api.put("/users/switcher/plan", {
      planId: PREMIUM_PLAN_ID,
    });
    expect(switched.statusCode).toBe(200);

    const fetched = await api.get("/users/switcher");
    expect(fetched.json<{ user: UserBody }>().user.plan.name).toBe("Premium");
  });

  it("shows the account plan and user plan together", async () => {
    await api.post("/users", { externalId: "effective" });
    const response = await api.get("/users/effective/effective-plans");
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      account: { plan: PlanBody };
      user: UserBody;
    }>();
    expect(body.account.plan).toMatchObject({
      name: "Starter",
      scope: "account",
    });
    expect(body.user.plan).toMatchObject({ name: "Basic", scope: "user" });
  });

  it("paginates users with a cursor", async () => {
    const fresh = asAccount(
      t.app,
      (await createAccount(t.app, "Paging Co")).apiKey,
    );
    for (const externalId of ["c", "a", "b"]) {
      await fresh.post("/users", { externalId });
    }

    const first = (await fresh.get("/users?limit=2")).json<{
      users: { externalId: string }[];
      nextCursor: string | null;
    }>();
    expect(first.users.map((user) => user.externalId)).toEqual(["a", "b"]);
    expect(first.nextCursor).toBe("b");

    const second = (await fresh.get("/users?limit=2&after=b")).json<{
      users: { externalId: string }[];
      nextCursor: string | null;
    }>();
    expect(second.users.map((user) => user.externalId)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });
});

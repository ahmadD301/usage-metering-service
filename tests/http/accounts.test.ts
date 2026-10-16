import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASIC_PLAN_ID, PRO_PLAN_ID } from "../../src/db/predefined-plans.js";
import {
  ADMIN_TOKEN,
  asAccount,
  createAccount,
  createTestApp,
  type ErrorBody,
  type PlanBody,
  type TestApp,
} from "../helpers/test-app.js";

const createRaw = (
  t: TestApp,
  payload: object,
  token: string | null = ADMIN_TOKEN,
) =>
  t.app.inject({
    method: "POST",
    url: "/accounts",
    headers: token === null ? {} : { "x-admin-token": token },
    payload,
  });

describe("POST /accounts (admin provisioning)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it("requires the admin token", async () => {
    const missing = await createRaw(t, { name: "A" }, null);
    expect(missing.statusCode).toBe(401);
    expect(missing.json<ErrorBody>().error.code).toBe("admin_unauthorized");

    const wrong = await createRaw(t, { name: "A" }, "wrong-token-wrong-token");
    expect(wrong.statusCode).toBe(401);
  });

  it("does not accept an account API key as an admin token", async () => {
    const account = await createAccount(t.app, "Not admin");
    expect((await createRaw(t, { name: "B" }, account.apiKey)).statusCode).toBe(
      401,
    );
  });

  it("creates an account on the Starter plan and returns the key once", async () => {
    const response = await createRaw(t, { name: "  Acme  " });
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      account: { id: string; name: string; plan: PlanBody };
      apiKey: string;
    }>();
    expect(body.apiKey).toMatch(/^mk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    expect(body.account.name).toBe("Acme");
    expect(body.account.plan).toMatchObject({
      name: "Starter",
      scope: "account",
      predefined: true,
    });

    const again = await asAccount(t.app, body.apiKey).get("/account");
    expect(again.statusCode).toBe(200);
    expect(again.body).not.toContain(body.apiKey);
  });

  it("lets the caller choose another predefined account plan", async () => {
    const response = await createRaw(t, {
      name: "Big Co",
      planId: PRO_PLAN_ID,
    });
    expect(response.statusCode).toBe(201);
    expect(
      response.json<{ account: { plan: PlanBody } }>().account.plan.name,
    ).toBe("Pro");
  });

  it("rejects a user-scope plan with 422", async () => {
    const response = await createRaw(t, { name: "X", planId: BASIC_PLAN_ID });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.code).toBe("plan_scope_mismatch");
  });

  it("rejects an unknown plan with 404", async () => {
    const response = await createRaw(t, {
      name: "X",
      planId: "11111111-1111-4111-8111-111111111111",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe("plan_not_found");
  });

  it("validates the body with details", async () => {
    const response = await createRaw(t, { name: "" });
    expect(response.statusCode).toBe(400);
    const error = response.json<ErrorBody>().error;
    expect(error.code).toBe("validation_error");
    expect(error.details).toEqual([expect.objectContaining({ path: "name" })]);
  });
});

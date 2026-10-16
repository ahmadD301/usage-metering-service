import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAccount,
  createAccount,
  createTestApp,
  type ErrorBody,
  type TestAccount,
  type TestApp,
} from "../helpers/test-app.js";

describe("API key authentication", () => {
  let t: TestApp;
  let acme: TestAccount;

  beforeAll(async () => {
    t = await createTestApp();
    acme = await createAccount(t.app, "Acme");
  });
  afterAll(async () => {
    await t.close();
  });

  it("rejects a request with no API key", async () => {
    const response = await t.app.inject({ method: "GET", url: "/account" });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe("missing_api_key");
  });

  it("treats a blank API key as missing", async () => {
    const response = await t.app.inject({
      method: "GET",
      url: "/account",
      headers: { "x-api-key": "   " },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe("missing_api_key");
  });

  it("rejects an unknown API key", async () => {
    const response = await asAccount(t.app, "mk_00000000_notarealkey").get(
      "/account",
    );
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe("invalid_api_key");
  });

  it("rejects a revoked API key", async () => {
    const other = await createAccount(t.app, "Revoked Co");
    await t.db.pool.query(
      "UPDATE api_keys SET revoked_at = now() WHERE account_id = $1",
      [other.id],
    );
    const response = await asAccount(t.app, other.apiKey).get("/account");
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe("invalid_api_key");
  });

  it("accepts a valid key and identifies the right account", async () => {
    const response = await asAccount(t.app, acme.apiKey).get("/account");
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ account: { id: string; name: string } }>().account,
    ).toMatchObject({
      id: acme.id,
      name: "Acme",
    });
  });

  it("checks the key before parsing the body (bad JSON without a key is a 401)", async () => {
    const response = await t.app.inject({
      method: "POST",
      url: "/users",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(response.statusCode).toBe(401);
  });

  it("reports malformed JSON from an authenticated caller as a 400 in the standard format", async () => {
    const response = await t.app.inject({
      method: "POST",
      url: "/users",
      headers: { "content-type": "application/json", "x-api-key": acme.apiKey },
      payload: "{not json",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe("bad_request");
  });

  it("stores only a hash of the key, never the key itself", async () => {
    const rows = await t.db.pool.query<{
      key_prefix: string;
      key_hash: string;
    }>("SELECT key_prefix, key_hash FROM api_keys WHERE account_id = $1", [
      acme.id,
    ]);
    const expectedHash = createHash("sha256").update(acme.apiKey).digest("hex");
    expect(rows.rows).toEqual([
      { key_prefix: acme.apiKey.slice(0, 11), key_hash: expectedHash },
    ]);
    expect(JSON.stringify(rows.rows)).not.toContain(acme.apiKey);
  });
});

describe("public and unknown routes", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it("serves health and readiness without a key", async () => {
    expect(
      (await t.app.inject({ method: "GET", url: "/health" })).statusCode,
    ).toBe(200);
    const ready = await t.app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json<{ status: string }>().status).toBe("ready");
  });

  it("returns the standard error format for unknown routes", async () => {
    const response = await t.app.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe("not_found");
  });
});

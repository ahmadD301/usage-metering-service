import { describe, expect, it } from "vitest";
import { createMeteringClient } from "../../client/metering-client.js";
import { harness, json } from "../helpers/http-stub.js";

const decision = {
  requestId: "r1",
  userId: "alice",
  units: 10,
  accepted: true,
  replayed: false,
  reason: null,
  plans: {
    account: { id: "a", name: "Starter" },
    user: { id: "u", name: "Basic" },
  },
  remaining: {
    account: { monthlyAllowance: 90, dailyAllowance: null, maxPerRequest: 100 },
    user: { monthlyAllowance: 990, dailyAllowance: null, maxPerRequest: 20 },
  },
  decidedAt: "2026-10-16T10:00:00.000Z",
};

describe("createMeteringClient", () => {
  it("sends the API key header on every call", async () => {
    const { http, calls } = harness([() => json(200, decision)]);
    const client = createMeteringClient(http, "mk_test_key");
    await client.consume({ userId: "alice", requestId: "r1", units: 10 });

    expect(calls[0]?.url).toBe("http://svc/consume");
    expect(calls[0]?.init.headers).toMatchObject({
      "x-api-key": "mk_test_key",
    });
  });

  it("reuses the same request id when it retries a consume", async () => {
    const { http, calls } = harness([
      () => json(503, { error: { code: "unavailable", message: "later" } }),
      () => json(200, decision),
    ]);
    const client = createMeteringClient(http, "k");
    const result = await client.consume({
      userId: "alice",
      requestId: "r1",
      units: 10,
    });

    expect(result.type === "ok").toBe(true);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      userId: "alice",
      requestId: "r1",
      units: 10,
    });
    expect(calls[1]?.init.body).toBe(calls[0]?.init.body);
  });

  it("does not retry creating a user", async () => {
    const { http, calls } = harness([
      () => json(503, { error: { code: "unavailable", message: "later" } }),
    ]);
    const client = createMeteringClient(http, "k");
    expect(
      (await client.createUser({ externalId: "alice" })).type === "ok",
    ).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("encodes path parameters", async () => {
    const { http, calls } = harness([
      () => json(404, { error: { code: "user_not_found", message: "no" } }),
    ]);
    const client = createMeteringClient(http, "k");
    await client.getUserUsage("a b/c");
    expect(calls[0]?.url).toBe("http://svc/users/a%20b%2Fc/usage");
  });

  it("treats a malformed consume response as invalid", async () => {
    const { http } = harness([() => json(200, { accepted: "yes" })]);
    const client = createMeteringClient(http, "k");
    const result = await client.consume({
      userId: "alice",
      requestId: "r1",
      units: 10,
    });
    expect(result.type === "ok").toBe(false);
    expect(result.type === "ok" ? null : result.error.kind).toBe(
      "invalid_response",
    );
  });
});

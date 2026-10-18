import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processDocument } from "../../client/documents.js";
import { createHttp, type FetchFn } from "../../client/http.js";
import { createMeteringClient } from "../../client/metering-client.js";
import { provisionAccount } from "../../client/provisioning.js";
import {
  readState,
  runScenario,
  setupDemoAccount,
} from "../../client/scenario.js";
import {
  ADMIN_TOKEN,
  createTestApp,
  type TestApp,
} from "../helpers/test-app.js";

const FIXED_NOW = new Date("2026-10-16T10:00:00.000Z");

describe("example client against the real service", () => {
  let t: TestApp;
  let baseUrl: string;

  beforeAll(async () => {
    t = await createTestApp({ clock: () => FIXED_NOW });
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const address = t.app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
  });
  afterAll(async () => {
    await t.close();
  });

  const makeHttp = (fetchFn: FetchFn) =>
    createHttp({
      baseUrl,
      timeoutMs: 5_000,
      maxRetries: 2,
      fetchFn,
      sleep: async () => undefined,
      random: () => 0,
    });

  const realFetch: FetchFn = (url, init) => fetch(url, init);

  const freshClient = async (fetchFn: FetchFn) => {
    const http = makeHttp(fetchFn);
    const provisioned = await provisionAccount(http, ADMIN_TOKEN, "E2E demo");
    if (provisioned.type === "err") {
      throw new Error(`provisioning failed: ${provisioned.error.kind}`);
    }
    const client = createMeteringClient(http, provisioned.value.apiKey);
    const demo = await setupDemoAccount(client);
    if (demo.type === "err") {
      throw new Error(`setup failed: ${demo.error.kind}`);
    }
    return { client, demo: demo.value };
  };

  it("runs the whole scripted scenario and every step behaves as expected", async () => {
    const { client, demo } = await freshClient(realFetch);
    const steps = await runScenario(client, demo);

    expect(steps).toHaveLength(8);
    expect(
      steps
        .filter((step) => !step.passed)
        .map((step) => `${step.title}: ${step.summary}`),
    ).toEqual([]);

    const state = await readState(client);
    expect(state.type === "ok").toBe(true);
    if (state.type === "ok") {
      expect(state.value.accountConsumed).toBe(75);
      expect(state.value.accountRemaining).toBe(25);
      expect(state.value.users).toMatchObject([
        { name: "alice", planName: "Premium", consumedThisMonth: 35 },
        { name: "bob", planName: "Premium", consumedThisMonth: 40 },
      ]);
    }
  });

  it("counts a request once when the response is lost and the client retries", async () => {
    let dropped = false;
    const dropFirstConsumeResponse: FetchFn = async (url, init) => {
      const response = await fetch(url, init);
      if (!dropped && url.endsWith("/consume")) {
        dropped = true;
        await response.text();
        throw new Error("connection reset after the server answered");
      }
      return response;
    };

    const { client } = await freshClient(dropFirstConsumeResponse);
    const outcome = await processDocument(client, {
      userId: "alice",
      pages: 10,
      requestId: "lost-1",
    });

    expect(dropped).toBe(true);
    expect(outcome.kind).toBe("processed");
    expect(outcome.kind === "processed" && outcome.replayed).toBe(true);

    const state = await readState(client);
    expect(state.type === "ok" && state.value.accountConsumed).toBe(10);
    expect(state.type === "ok" && state.value.users[0]?.consumedThisMonth).toBe(
      10,
    );
  });

  it("reports a clear failure for an unknown user without throwing", async () => {
    const { client } = await freshClient(realFetch);
    const outcome = await processDocument(client, {
      userId: "ghost",
      pages: 1,
      requestId: "g1",
    });
    expect(outcome).toMatchObject({
      kind: "failed",
      error: { kind: "api", status: 404, code: "user_not_found" },
    });
  });
});

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import { createTestDb, type TestDb } from "./test-db.js";

export const ADMIN_TOKEN = "test-admin-token-0123456789";

export type ErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export type PlanBody = {
  id: string;
  name: string;
  scope: "account" | "user";
  predefined: boolean;
  rules: { kind: string; limit: number }[];
};

export type TestApp = {
  readonly app: FastifyInstance;
  readonly db: TestDb;
  readonly close: () => Promise<void>;
};

export type TestAppOptions = {
  // Fake "now" for the service. Defaults to the system clock.
  readonly clock?: () => Date;
};

export const createTestApp = async (
  options: TestAppOptions = {},
): Promise<TestApp> => {
  const db = await createTestDb();
  const app = buildApp({
    pool: db.pool,
    adminToken: ADMIN_TOKEN,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  await app.ready();
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await db.close();
    },
  };
};

// A clock tests can move: `set("2026-11-01T00:00:00.000Z")`.
export const mutableClock = (
  startIso: string,
): { now: () => Date; set: (iso: string) => void } => {
  let current = new Date(startIso);
  return {
    now: () => current,
    set: (iso) => {
      current = new Date(iso);
    },
  };
};

export type TestAccount = { readonly id: string; readonly apiKey: string };

export const createAccount = async (
  app: FastifyInstance,
  name: string,
  planId?: string,
): Promise<TestAccount> => {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    headers: { "x-admin-token": ADMIN_TOKEN },
    payload: planId === undefined ? { name } : { name, planId },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createAccount failed: ${response.body}`);
  }
  const body = response.json<{ account: { id: string }; apiKey: string }>();
  return { id: body.account.id, apiKey: body.apiKey };
};

// Small client bound to one API key.
export const asAccount = (app: FastifyInstance, apiKey: string) => ({
  get: (url: string) =>
    app.inject({ method: "GET", url, headers: { "x-api-key": apiKey } }),
  post: (url: string, payload: object) =>
    app.inject({
      method: "POST",
      url,
      headers: { "x-api-key": apiKey },
      payload,
    }),
  put: (url: string, payload: object) =>
    app.inject({
      method: "PUT",
      url,
      headers: { "x-api-key": apiKey },
      payload,
    }),
});

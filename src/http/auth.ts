import { createHash, timingSafeEqual } from "node:crypto";
import type {
  FastifyRequest,
  onRequestAsyncHookHandler,
  onRequestHookHandler,
} from "fastify";
import type pg from "pg";
import { findAccountByApiKeyHash, type AccountRecord } from "../db/accounts.js";
import { hashApiKey } from "./api-keys.js";
import { httpErrors } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    // Set by the API key hook.
    account: AccountRecord | null;
  }
}

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

// Constant-time comparison. Hashing first gives both sides equal length.
export const tokensMatch = (provided: string, expected: string): boolean =>
  timingSafeEqual(digest(provided), digest(expected));

export const requireAdminToken =
  (expected: string): onRequestHookHandler =>
  (request, _reply, done) => {
    const provided = request.headers["x-admin-token"];
    if (typeof provided !== "string" || !tokensMatch(provided, expected)) {
      done(httpErrors.adminUnauthorized());
      return;
    }
    done();
  };

export const requireApiKey =
  (pool: pg.Pool): onRequestAsyncHookHandler =>
  async (request) => {
    const header = request.headers["x-api-key"];
    if (typeof header !== "string" || header.trim() === "") {
      throw httpErrors.missingApiKey();
    }
    const account = await findAccountByApiKeyHash(
      pool,
      hashApiKey(header.trim()),
    );
    if (account === null) {
      throw httpErrors.invalidApiKey();
    }
    request.account = account;
  };

// Route handlers call this to get the authenticated account (never from URL or body).
export const accountOf = (request: FastifyRequest): AccountRecord => {
  if (request.account === null) {
    throw new Error("accountOf() called on a route without the API key hook");
  }
  return request.account;
};

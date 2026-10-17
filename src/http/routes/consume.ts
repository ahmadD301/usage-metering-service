import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import { consume } from "../../consume/consume.js";
import type { ConsumeError } from "../../consume/types.js";
import { buildUsageView, periodFor } from "../../consume/usage-view.js";
import { loadEffectivePlans } from "../../db/effective-plans.js";
import { findPlanById } from "../../db/plans.js";
import { listHistory } from "../../db/requests.js";
import { readUsage } from "../../db/usage.js";
import {
  MAX_UNITS_PER_REQUEST,
  parseUnits,
  type UnitsError,
} from "../../domain/index.js";
import { assertNever } from "../../shared/assert-never.js";
import { accountOf, requireApiKey } from "../auth.js";
import { decodeCursor, encodeCursor } from "../cursor.js";
import { systemClock, type AppDeps } from "../deps.js";
import { httpErrors, type AppError } from "../errors.js";
import { parseWith } from "../validation.js";

const externalIdSchema = z.string().min(1).max(200);
// "YYYY-MM", years 1900 to 2999.
const monthSchema = z.string().regex(/^(19|2\d)\d{2}-(0[1-9]|1[0-2])$/);

const consumeBody = z.object({
  userId: externalIdSchema,
  requestId: z.string().min(1).max(200),
  units: z.number(),
});
const monthQuery = z.object({ month: monthSchema.optional() });
const userParams = z.object({ externalId: externalIdSchema });
const historyQuery = z.object({
  month: monthSchema.optional(),
  userId: externalIdSchema.optional(),
  outcome: z.enum(["accepted", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(500).optional(),
});

const unitsMessage = (error: UnitsError): string => {
  switch (error) {
    case "not_a_positive_integer":
      return "units must be a positive whole number";
    case "too_large":
      return `units must not exceed ${String(MAX_UNITS_PER_REQUEST)}`;
    default:
      return assertNever(error);
  }
};

const toHttpError = (error: ConsumeError): AppError => {
  switch (error) {
    case "user_not_found":
      return httpErrors.userNotFound();
    case "idempotency_conflict":
      return httpErrors.idempotencyConflict();
    default:
      return assertNever(error);
  }
};

export const consumeRoutes =
  (deps: AppDeps): FastifyPluginCallback =>
  (scope, _options, done) => {
    const { pool } = deps;
    const clock = deps.clock ?? systemClock;
    scope.addHook("onRequest", requireApiKey(pool));

    // ---- Consume ----

    scope.post("/consume", async (request) => {
      const account = accountOf(request);
      const body = parseWith(consumeBody, request.body);
      const units = parseUnits(body.units);
      if (units.type === "err") {
        throw httpErrors.validation([
          { path: "units", message: unitsMessage(units.error) },
        ]);
      }
      const result = await consume(pool, {
        accountId: account.id,
        userId: body.userId,
        requestId: body.requestId,
        units: units.value,
        now: clock(),
      });
      if (result.type === "err") {
        throw toHttpError(result.error);
      }
      return result.value;
    });

    // ---- Usage ----

    scope.get("/usage", async (request) => {
      const account = accountOf(request);
      const query = parseWith(monthQuery, request.query);
      const period = periodFor(query.month, clock());
      const [plan, usage] = await Promise.all([
        findPlanById(pool, account.planId),
        readUsage(pool, {
          accountId: account.id,
          userId: null,
          monthStart: period.monthStart,
          dayStart: period.dayStart,
        }),
      ]);
      if (plan === null) {
        throw new Error(`Plan ${account.planId} is referenced but missing`);
      }
      return { account: buildUsageView(period, plan, usage.account) };
    });

    scope.get("/users/:externalId/usage", async (request) => {
      const account = accountOf(request);
      const { externalId } = parseWith(userParams, request.params);
      const query = parseWith(monthQuery, request.query);
      const period = periodFor(query.month, clock());

      const found = await loadEffectivePlans(pool, account.id, externalId);
      if (found === null) {
        throw httpErrors.userNotFound();
      }
      const usage = await readUsage(pool, {
        accountId: account.id,
        userId: found.userInternalId,
        monthStart: period.monthStart,
        dayStart: period.dayStart,
      });
      return {
        user: {
          userId: externalId,
          ...buildUsageView(period, found.userPlan, usage.user),
        },
        account: buildUsageView(period, found.accountPlan, usage.account),
      };
    });

    // ---- History ----

    scope.get("/history", async (request) => {
      const account = accountOf(request);
      const query = parseWith(historyQuery, request.query);
      const after =
        query.cursor === undefined ? null : decodeCursor(query.cursor);
      if (query.cursor !== undefined && after === null) {
        throw httpErrors.validation([
          { path: "cursor", message: "cursor is invalid" },
        ]);
      }
      const page = await listHistory(pool, {
        accountId: account.id,
        month: query.month === undefined ? null : `${query.month}-01`,
        userExternalId: query.userId ?? null,
        outcome: query.outcome ?? null,
        limit: query.limit,
        after,
      });
      return {
        requests: page.entries.map((entry) => ({
          ...entry.decision,
          createdAt: entry.createdAt,
        })),
        nextCursor:
          page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      };
    });

    done();
  };

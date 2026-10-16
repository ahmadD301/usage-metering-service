import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import { createAccountWithKey } from "../../db/accounts.js";
import { findAssignablePlan } from "../../db/plans.js";
import { DEFAULT_ACCOUNT_PLAN_ID } from "../../db/predefined-plans.js";
import { generateApiKey } from "../api-keys.js";
import { requireAdminToken } from "../auth.js";
import type { AppDeps } from "../deps.js";
import { toAccountDto } from "../dto.js";
import { fromPlanLookupError } from "../errors.js";
import { parseWith } from "../validation.js";

const createAccountBody = z.object({
  name: z.string().trim().min(1).max(200),
  planId: z.string().uuid().optional(),
});

export const adminRoutes =
  (deps: AppDeps): FastifyPluginCallback =>
  (scope, _options, done) => {
    scope.addHook("onRequest", requireAdminToken(deps.adminToken));

    scope.post("/accounts", async (request, reply) => {
      const body = parseWith(createAccountBody, request.body);
      const planResult = await findAssignablePlan(
        deps.pool,
        null,
        body.planId ?? DEFAULT_ACCOUNT_PLAN_ID,
        "account",
      );
      if (planResult.type === "err") {
        throw fromPlanLookupError(planResult.error, "account");
      }
      const apiKey = generateApiKey();
      const account = await createAccountWithKey(deps.pool, {
        name: body.name,
        planId: planResult.value.id,
        keyPrefix: apiKey.prefix,
        keyHash: apiKey.hash,
      });
      reply.code(201);
      return {
        account: toAccountDto(account, planResult.value),
        apiKey: apiKey.key,
      };
    });

    done();
  };

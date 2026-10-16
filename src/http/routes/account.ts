import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import { RULE_KINDS } from "../../domain/index.js";
import { setAccountPlan } from "../../db/accounts.js";
import {
  createCustomPlan,
  findAssignablePlan,
  findPlanById,
  findVisiblePlan,
  listPlansForAccount,
  updateCustomPlan,
  type PlanRecord,
} from "../../db/plans.js";
import { DEFAULT_USER_PLAN_ID } from "../../db/predefined-plans.js";
import { createUser, findUser, listUsers, setUserPlan } from "../../db/users.js";
import type pg from "pg";
import { accountOf, requireApiKey } from "../auth.js";
import type { AppDeps } from "../deps.js";
import { toAccountDto, toPlanDto, toUserDto, toUserSummaryDto } from "../dto.js";
import {
  fromPlanLookupError,
  fromPlanUpdateError,
  httpErrors,
} from "../errors.js";
import { parseWith } from "../validation.js";

// ---- Input schemas (the boundary: everything past here is typed) ----

const externalIdSchema = z.string().min(1).max(200);
const planIdSchema = z.string().uuid();
const scopeSchema = z.enum(["account", "user"]);

const rulesSchema = z
  .array(
    z.object({
      kind: z.enum(RULE_KINDS),
      limit: z.number().int().min(0).max(1_000_000_000_000),
    }),
  )
  .max(RULE_KINDS.length)
  .refine((rules) => new Set(rules.map((rule) => rule.kind)).size === rules.length, {
    message: "each rule kind may appear at most once",
  });

const planBody = z.object({
  name: z.string().trim().min(1).max(100),
  rules: rulesSchema,
});
const createPlanBody = planBody.extend({ scope: scopeSchema });
const assignPlanBody = z.object({ planId: planIdSchema });
const createUserBody = z.object({
  externalId: externalIdSchema,
  planId: planIdSchema.optional(),
});
const listUsersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after: z.string().min(1).max(200).optional(),
});
const listPlansQuery = z.object({ scope: scopeSchema.optional() });
const userParams = z.object({ externalId: externalIdSchema });
const planParams = z.object({ planId: planIdSchema });

// ---- Small helpers ----
//Plans referenced by a stored account/user always exist (foreign keys).
const requirePlan = async (pool: pg.Pool, planId: string): Promise<PlanRecord> => {
  const plan = await findPlanById(pool, planId);
  if (plan === null) {
    throw new Error(`Plan ${planId} is referenced but missing`);
  }
  return plan;
};

export const accountRoutes =
  (deps: AppDeps): FastifyPluginCallback =>
  (scope, _options, done) => {
    const { pool } = deps;
    scope.addHook("onRequest", requireApiKey(pool));

    // ---- Account ----

    scope.get("/account", async (request) => {
      const account = accountOf(request);
      return { account: toAccountDto(account, await requirePlan(pool, account.planId)) };
    });

    scope.put("/account/plan", async (request) => {
      const account = accountOf(request);
      const { planId } = parseWith(assignPlanBody, request.body);
      const found = await findAssignablePlan(pool, account.id, planId, "account");
      if (!found.type || found.type === "err") {
        throw fromPlanLookupError(found.error, "account");
      }
      const updated = await setAccountPlan(pool, account.id, found.value.id);
      return { account: toAccountDto(updated, found.value) };
    });

    // ---- Users ----

    scope.post("/users", async (request, reply) => {
      const account = accountOf(request);
      const body = parseWith(createUserBody, request.body);
      const found = await findAssignablePlan(
        pool,
        account.id,
        body.planId ?? DEFAULT_USER_PLAN_ID,
        "user",
      );
      if (!found.type || found.type === "err") {
        throw fromPlanLookupError(found.error, "user");
      }
      const created = await createUser(pool, account.id, body.externalId, found.value.id);
      if (!created.type || created.type === "err") {
        throw httpErrors.userAlreadyExists();
      }
      reply.code(201);
      return { user: toUserDto(created.value, found.value) };
    });

    scope.get("/users", async (request) => {
      const account = accountOf(request);
      const query = parseWith(listUsersQuery, request.query);
      const page = await listUsers(pool, account.id, {
        limit: query.limit,
        after: query.after ?? null,
      });
      return { users: page.users.map(toUserSummaryDto), nextCursor: page.nextCursor };
    });

    scope.get("/users/:externalId", async (request) => {
      const account = accountOf(request);
      const { externalId } = parseWith(userParams, request.params);
      const user = await findUser(pool, account.id, externalId);
      if (user === null) {
        throw httpErrors.userNotFound();
      }
      return { user: toUserDto(user, await requirePlan(pool, user.planId)) };
    });

    scope.put("/users/:externalId/plan", async (request) => {
      const account = accountOf(request);
      const { externalId } = parseWith(userParams, request.params);
      const { planId } = parseWith(assignPlanBody, request.body);

      if ((await findUser(pool, account.id, externalId)) === null) {
        throw httpErrors.userNotFound();
      }
      const found = await findAssignablePlan(pool, account.id, planId, "user");
      if (!found.type || found.type === "err") {
        throw fromPlanLookupError(found.error, "user");
      }
      const updated = await setUserPlan(pool, account.id, externalId, found.value.id);
      if (updated === null) {
        throw httpErrors.userNotFound();
      }
      return { user: toUserDto(updated, found.value) };
    });

    // Both plans that apply together to this user's requests.
    scope.get("/users/:externalId/effective-plans", async (request) => {
      const account = accountOf(request);
      const { externalId } = parseWith(userParams, request.params);
      const user = await findUser(pool, account.id, externalId);
      if (user === null) {
        throw httpErrors.userNotFound();
      }
      const [accountPlan, userPlan] = await Promise.all([
        requirePlan(pool, account.planId),
        requirePlan(pool, user.planId),
      ]);
      return {
        account: { plan: toPlanDto(accountPlan) },
        user: { externalId: user.externalId, plan: toPlanDto(userPlan) },
      };
    });

    // ---- Plans ----

    scope.get("/plans", async (request) => {
      const account = accountOf(request);
      const query = parseWith(listPlansQuery, request.query);
      const plans = await listPlansForAccount(pool, account.id);
      return {
        plans: plans
          .filter((plan) => query.scope === undefined || plan.scope === query.scope)
          .map(toPlanDto),
      };
    });

    scope.post("/plans", async (request, reply) => {
      const account = accountOf(request);
      const body = parseWith(createPlanBody, request.body);
      const created = await createCustomPlan(pool, account.id, body);
      if (!created.type || created.type === "err") {
        throw httpErrors.planNameTaken();
      }
      reply.code(201);
      return { plan: toPlanDto(created.value) };
    });

    scope.get("/plans/:planId", async (request) => {
      const account = accountOf(request);
      const { planId } = parseWith(planParams, request.params);
      const plan = await findVisiblePlan(pool, account.id, planId);
      if (plan === null) {
        throw httpErrors.planNotFound();
      }
      return { plan: toPlanDto(plan) };
    });

    scope.put("/plans/:planId", async (request) => {
      const account = accountOf(request);
      const { planId } = parseWith(planParams, request.params);
      const body = parseWith(planBody, request.body);
      const updated = await updateCustomPlan(pool, account.id, planId, body);
      if (!updated.type || updated.type === "err") {
        throw fromPlanUpdateError(updated.error);
      }
      return { plan: toPlanDto(updated.value) };
    });

    done();
  };
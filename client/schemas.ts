import { z } from "zod";

const ruleKind = z.enum([
  "max_per_request",
  "monthly_allowance",
  "daily_allowance",
]);
const planRef = z.object({ id: z.string(), name: z.string() });

const remaining = z.object({
  monthlyAllowance: z.number().nullable(),
  dailyAllowance: z.number().nullable(),
  maxPerRequest: z.number().nullable(),
});

const violation = z.object({
  level: z.enum(["account", "user"]),
  rule: ruleKind,
  limit: z.number(),
  used: z.number().nullable(),
  remaining: z.number(),
  requested: z.number(),
});

export const consumeResponse = z.object({
  requestId: z.string(),
  userId: z.string(),
  units: z.number(),
  accepted: z.boolean(),
  replayed: z.boolean(),
  reason: z
    .object({ primary: violation, violations: z.array(violation) })
    .nullable(),
  plans: z.object({ account: planRef, user: planRef }),
  remaining: z.object({ account: remaining, user: remaining }),
  decidedAt: z.string(),
});

const plan = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(["account", "user"]),
  predefined: z.boolean(),
  rules: z.array(z.object({ kind: ruleKind, limit: z.number() })),
});

const usageView = z.object({
  month: z.string(),
  isCurrentMonth: z.boolean(),
  plan: planRef,
  consumed: z.object({ month: z.number(), today: z.number().nullable() }),
  remaining: remaining.nullable(),
});

export const planResponse = z.object({ plan });
export const plansResponse = z.object({ plans: z.array(plan) });
export const userResponse = z.object({
  user: z.object({ externalId: z.string(), plan }),
});
export const accountResponse = z.object({
  account: z.object({ id: z.string(), name: z.string(), plan }),
});
export const provisionedAccountResponse = z.object({
  account: z.object({ id: z.string(), name: z.string(), plan }),
  apiKey: z.string().min(1),
});
export const accountUsageResponse = z.object({ account: usageView });
export const userUsageResponse = z.object({
  user: usageView.extend({ userId: z.string() }),
  account: usageView,
});
export const effectivePlansResponse = z.object({
  account: z.object({ plan }),
  user: z.object({ externalId: z.string(), plan }),
});
export const historyResponse = z.object({
  requests: z.array(
    consumeResponse.omit({ replayed: true }).extend({ createdAt: z.string() }),
  ),
  nextCursor: z.string().nullable(),
});

export type ConsumeResponse = z.infer<typeof consumeResponse>;
export type Violation = z.infer<typeof violation>;
export type UserUsageResponse = z.infer<typeof userUsageResponse>;
export type PlanView = z.infer<typeof plan>;

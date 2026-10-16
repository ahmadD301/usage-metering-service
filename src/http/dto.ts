import type { AccountRecord } from "../db/accounts.js";
import type { PlanRecord } from "../db/plans.js";
import type { UserRecord } from "../db/users.js";

export const toPlanDto = (plan: PlanRecord) => ({
  id: plan.id,
  name: plan.name,
  scope: plan.scope,
  predefined: plan.predefined,
  rules: plan.rules.map((rule) => ({ kind: rule.kind, limit: rule.limit })),
});

export const toAccountDto = (account: AccountRecord, plan: PlanRecord) => ({
  id: account.id,
  name: account.name,
  createdAt: account.createdAt,
  plan: toPlanDto(plan),
});

export const toUserDto = (user: UserRecord, plan: PlanRecord) => ({
  externalId: user.externalId,
  createdAt: user.createdAt,
  plan: toPlanDto(plan),
});

export const toUserSummaryDto = (user: UserRecord) => ({
  externalId: user.externalId,
  planId: user.planId,
  createdAt: user.createdAt,
});
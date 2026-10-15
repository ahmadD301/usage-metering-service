import type { Level, RuleConfig } from "../domain/index.js";

export type PredefinedPlan = {
  readonly id: string;
  readonly name: string;
  readonly scope: Level;
  readonly rules: readonly RuleConfig[];
};

export const STARTER_PLAN_ID = "00000000-0000-4000-8000-000000000001";
export const PRO_PLAN_ID = "00000000-0000-4000-8000-000000000002";
export const BASIC_PLAN_ID = "00000000-0000-4000-8000-000000000003";
export const PREMIUM_PLAN_ID = "00000000-0000-4000-8000-000000000004";

/** Defaults for new accounts and users (assumption A12). */
export const DEFAULT_ACCOUNT_PLAN_ID = STARTER_PLAN_ID;
export const DEFAULT_USER_PLAN_ID = BASIC_PLAN_ID;

export const PREDEFINED_PLANS: readonly PredefinedPlan[] = [
  {
    id: STARTER_PLAN_ID,
    name: "Starter",
    scope: "account",
    rules: [
      { kind: "monthly_allowance", limit: 10_000 },
      { kind: "max_per_request", limit: 100 },
    ],
  },
  {
    id: PRO_PLAN_ID,
    name: "Pro",
    scope: "account",
    rules: [
      { kind: "monthly_allowance", limit: 100_000 },
      { kind: "max_per_request", limit: 1_000 },
    ],
  },
  {
    id: BASIC_PLAN_ID,
    name: "Basic",
    scope: "user",
    rules: [
      { kind: "monthly_allowance", limit: 1_000 },
      { kind: "max_per_request", limit: 20 },
    ],
  },
  {
    id: PREMIUM_PLAN_ID,
    name: "Premium",
    scope: "user",
    rules: [
      { kind: "monthly_allowance", limit: 10_000 },
      { kind: "max_per_request", limit: 200 },
    ],
  },
];

//Plan	    Scope	    Monthly allowance	    Max per request
//Starter	account 	10,000	                100
//Pro	    account	    100,000	                1,000
//Basic	    user	    1,000	                20
//Premium	user	    10,000	                200
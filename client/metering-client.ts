import {
  createHttp,
  type ClientError,
  type HttpCall,
  type HttpOptions,
} from "./http.js";
import {
  accountResponse,
  accountUsageResponse,
  consumeResponse,
  effectivePlansResponse,
  historyResponse,
  planResponse,
  plansResponse,
  userResponse,
  userUsageResponse,
} from "./schemas.js";

//  ----------------------------------
//  typed methods for the metering API
//  ----------------------------------

export type { ClientError };

export type ClientRuntime = Pick<HttpOptions, "fetchFn" | "sleep" | "random">;

export const systemRuntime: ClientRuntime = {
  fetchFn: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export type ClientSettings = Pick<
  HttpOptions,
  "baseUrl" | "timeoutMs" | "maxRetries"
>;

export const createHttpFor = (
  settings: ClientSettings,
  runtime: ClientRuntime = systemRuntime,
): HttpCall => createHttp({ ...settings, ...runtime });

export type ConsumeInput = {
  readonly userId: string;
  readonly requestId: string;
  readonly units: number;
};

export type PlanRuleInput = {
  readonly kind: "max_per_request" | "monthly_allowance" | "daily_allowance";
  readonly limit: number;
};

export const createMeteringClient = (http: HttpCall, apiKey: string) => {
  const headers = { "x-api-key": apiKey };
  const enc = encodeURIComponent;

  return {
    // Idempotent through requestId, so it is safe to retry.
    consume: (input: ConsumeInput) =>
      http({
        method: "POST",
        path: "/consume",
        body: input,
        headers,
        schema: consumeResponse,
        retry: true,
      }),

    getAccountUsage: () =>
      http({
        method: "GET",
        path: "/usage",
        headers,
        schema: accountUsageResponse,
        retry: true,
      }),

    getUserUsage: (userId: string) =>
      http({
        method: "GET",
        path: `/users/${enc(userId)}/usage`,
        headers,
        schema: userUsageResponse,
        retry: true,
      }),

    getEffectivePlans: (userId: string) =>
      http({
        method: "GET",
        path: `/users/${enc(userId)}/effective-plans`,
        headers,
        schema: effectivePlansResponse,
        retry: true,
      }),

    listPlans: (scope?: "account" | "user") =>
      http({
        method: "GET",
        path: scope === undefined ? "/plans" : `/plans?scope=${scope}`,
        headers,
        schema: plansResponse,
        retry: true,
      }),

    getHistory: (limit = 20) =>
      http({
        method: "GET",
        path: `/history?limit=${String(limit)}`,
        headers,
        schema: historyResponse,
        retry: true,
      }),

    // Creates are not retried: repeating one after a lost response would return a 409.
    createPlan: (input: {
      readonly name: string;
      readonly scope: "account" | "user";
      readonly rules: readonly PlanRuleInput[];
    }) =>
      http({
        method: "POST",
        path: "/plans",
        body: input,
        headers,
        schema: planResponse,
        retry: false,
      }),

    updatePlan: (
      planId: string,
      input: {
        readonly name: string;
        readonly rules: readonly PlanRuleInput[];
      },
    ) =>
      http({
        method: "PUT",
        path: `/plans/${enc(planId)}`,
        body: input,
        headers,
        schema: planResponse,
        retry: true,
      }),

    createUser: (input: {
      readonly externalId: string;
      readonly planId?: string;
    }) =>
      http({
        method: "POST",
        path: "/users",
        body: input,
        headers,
        schema: userResponse,
        retry: false,
      }),

    setUserPlan: (userId: string, planId: string) =>
      http({
        method: "PUT",
        path: `/users/${enc(userId)}/plan`,
        body: { planId },
        headers,
        schema: userResponse,
        retry: true,
      }),

    setAccountPlan: (planId: string) =>
      http({
        method: "PUT",
        path: "/account/plan",
        body: { planId },
        headers,
        schema: accountResponse,
        retry: true,
      }),
  };
};

export type MeteringClient = ReturnType<typeof createMeteringClient>;

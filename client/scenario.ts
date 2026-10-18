import { err, ok, type Result } from "../src/shared/result.js";
import {
  processDocument,
  summarizeOutcome,
  type DocumentOutcome,
} from "./documents.js";
import type { ClientError } from "./http.js";
import type { MeteringClient } from "./metering-client.js";
import type { UserUsageResponse, Violation } from "./schemas.js";

export const ALICE = "alice";
export const BOB = "bob";

export type DemoAccount = {
  readonly basicPlanId: string;
  readonly premiumPlanId: string;
};

const failure = (message: string): ClientError => ({
  kind: "invalid_response",
  message,
});

/**
 * Prepares a FRESH account: a small custom account plan (100 per month, 50 per request),
 * alice on Basic, bob on Premium. Account usage persists within a month, so the scripted
 * scenario needs a brand-new account to be deterministic.
 */
export const setupDemoAccount = async (
  client: MeteringClient,
): Promise<Result<DemoAccount, ClientError>> => {
  const userPlans = await client.listPlans("user");
  if (userPlans.type === "err") {
    return err(userPlans.error);
  }
  const find = (name: string) =>
    userPlans.value.plans.find((plan) => plan.predefined && plan.name === name);
  const basic = find("Basic");
  const premium = find("Premium");
  if (basic === undefined || premium === undefined) {
    return err(failure("The predefined Basic and Premium plans are missing"));
  }

  const accountPlan = await client.createPlan({
    name: "Demo account plan",
    scope: "account",
    rules: [
      { kind: "monthly_allowance", limit: 100 },
      { kind: "max_per_request", limit: 50 },
    ],
  });
  if (accountPlan.type === "err") {
    return err(accountPlan.error);
  }
  const assigned = await client.setAccountPlan(accountPlan.value.plan.id);
  if (assigned.type === "err") {
    return err(assigned.error);
  }

  const alice = await client.createUser({
    externalId: ALICE,
    planId: basic.id,
  });
  if (alice.type === "err") {
    return err(alice.error);
  }
  const bob = await client.createUser({ externalId: BOB, planId: premium.id });
  if (bob.type === "err") {
    return err(bob.error);
  }
  return ok({ basicPlanId: basic.id, premiumPlanId: premium.id });
};

export type StepResult = {
  readonly title: string;
  readonly expected: string;
  readonly passed: boolean;
  readonly summary: string;
  readonly outcome: DocumentOutcome | null;
};

const isProcessed =
  (replayed: boolean) =>
  (outcome: DocumentOutcome): boolean =>
    outcome.kind === "processed" && outcome.replayed === replayed;

const isRejectedBy =
  (level: Violation["level"], rule: Violation["rule"]) =>
  (outcome: DocumentOutcome): boolean =>
    outcome.kind === "rejected" &&
    outcome.reason.level === level &&
    outcome.reason.rule === rule;

type ProcessStep = {
  readonly title: string;
  readonly expected: string;
  readonly userId: string;
  readonly pages: number;
  readonly requestId: string;
  readonly passes: (outcome: DocumentOutcome) => boolean;
};

const processStep = async (
  client: MeteringClient,
  step: ProcessStep,
): Promise<StepResult> => {
  const outcome = await processDocument(client, {
    userId: step.userId,
    pages: step.pages,
    requestId: step.requestId,
  });
  return {
    title: step.title,
    expected: step.expected,
    passed: step.passes(outcome),
    summary: summarizeOutcome(outcome, step.userId),
    outcome,
  };
};

/** Runs the scripted scenario against a freshly prepared demo account. */
export const runScenario = async (
  client: MeteringClient,
  demo: DemoAccount,
): Promise<readonly StepResult[]> => {
  const results: StepResult[] = [];

  results.push(
    await processStep(client, {
      title: "1. alice processes 10 pages",
      expected: "accepted",
      userId: ALICE,
      pages: 10,
      requestId: "scenario-1",
      passes: isProcessed(false),
    }),
  );

  results.push(
    await processStep(client, {
      title:
        "2. alice processes 25 pages (her Basic plan allows 20 per request)",
      expected: "rejected by the USER per-request limit",
      userId: ALICE,
      pages: 25,
      requestId: "scenario-2",
      passes: isRejectedBy("user", "max_per_request"),
    }),
  );

  const switched = await client.setUserPlan(ALICE, demo.premiumPlanId);
  results.push({
    title:
      "3. Switch alice from Basic to Premium (an API call, no client code change)",
    expected: "plan change succeeds",
    passed: switched.type === "ok",
    summary:
      switched.type === "ok"
        ? "alice is now on Premium."
        : `FAILED: ${switched.error.kind}`,
    outcome: null,
  });

  results.push(
    await processStep(client, {
      title: "4. alice processes 25 pages again (same code as step 2)",
      expected: "accepted now",
      userId: ALICE,
      pages: 25,
      requestId: "scenario-4",
      passes: isProcessed(false),
    }),
  );

  results.push(
    await processStep(client, {
      title: "5. bob processes 40 pages",
      expected: "accepted",
      userId: BOB,
      pages: 40,
      requestId: "scenario-5",
      passes: isProcessed(false),
    }),
  );

  results.push(
    await processStep(client, {
      title: "6. bob processes 30 pages (the shared account has 25 left)",
      expected:
        "rejected by the shared ACCOUNT allowance, even though bob has plenty",
      userId: BOB,
      pages: 30,
      requestId: "scenario-6",
      passes: isRejectedBy("account", "monthly_allowance"),
    }),
  );

  results.push(
    await processStep(client, {
      title: "7. Retry the exact request from step 1 (same request id)",
      expected: "replayed, not counted again",
      userId: ALICE,
      pages: 10,
      requestId: "scenario-1",
      passes: isProcessed(true),
    }),
  );

  const usage = await client.getAccountUsage();
  const consumed =
    usage.type === "ok" ? usage.value.account.consumed.month : null;
  results.push({
    title: "8. Read the account usage",
    expected:
      "75 units used: 10 + 25 + 40, with the replay and both rejections not counted",
    passed: consumed === 75,
    summary:
      usage.type === "ok"
        ? `The account has used ${String(consumed)} units this month.`
        : "FAILED to read usage",
    outcome: null,
  });

  return results;
};

export type UserState = {
  readonly name: string;
  readonly planName: string;
  readonly consumedThisMonth: number;
  readonly monthlyRemaining: number | null;
  readonly maxPerRequest: number | null;
};

export type DemoState = {
  readonly accountPlan: string;
  readonly accountConsumed: number;
  readonly accountRemaining: number | null;
  readonly users: readonly UserState[];
};

const toUserState = (name: string, response: UserUsageResponse): UserState => ({
  name,
  planName: response.user.plan.name,
  consumedThisMonth: response.user.consumed.month,
  monthlyRemaining: response.user.remaining?.monthlyAllowance ?? null,
  maxPerRequest: response.user.remaining?.maxPerRequest ?? null,
});

/** What the screen shows: the shared account figures and each user's figures. */
export const readState = async (
  client: MeteringClient,
): Promise<Result<DemoState, ClientError>> => {
  const [alice, bob] = await Promise.all([
    client.getUserUsage(ALICE),
    client.getUserUsage(BOB),
  ]);
  if (alice.type === "err") {
    return err(alice.error);
  }
  if (bob.type === "err") {
    return err(bob.error);
  }
  const { account } = alice.value;
  return ok({
    accountPlan: account.plan.name,
    accountConsumed: account.consumed.month,
    accountRemaining: account.remaining?.monthlyAllowance ?? null,
    users: [toUserState(ALICE, alice.value), toUserState(BOB, bob.value)],
  });
};

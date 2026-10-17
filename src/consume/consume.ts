import type pg from "pg";
import {
  dayPeriodKey,
  evaluate,
  monthPeriodKey,
  type EvaluationContext,
} from "../domain/index.js";
import { withTransaction } from "../db/client.js";
import { loadEffectivePlans, userExists } from "../db/effective-plans.js";
import {
  findRequest,
  insertRequest,
  type StoredRequest,
} from "../db/requests.js";
import {
  ensureAccountMonthRow,
  lockAccountMonth,
  readUsage,
  recordAccountUsage,
  recordUserUsage,
} from "../db/usage.js";
import { err, ok, type Result } from "../shared/result.js";
import { buildStoredDecision } from "./decision.js";
import { fingerprintOf } from "./fingerprint.js";
import type { ConsumeCommand, ConsumeError, ConsumeResponse } from "./types.js";

type ConsumeResult = Result<ConsumeResponse, ConsumeError>;

// a different payload is a conflict.
const replayOrConflict = (
  existing: StoredRequest,
  fingerprint: string,
): ConsumeResult => {
  if (existing.fingerprint === fingerprint) {
    return ok({
      ...existing.decision,
      replayed: true,
    });
  }

  return err("idempotency_conflict");
};

const decideInTransaction = async (
  client: pg.PoolClient,
  command: ConsumeCommand,
  fingerprint: string,
): Promise<ConsumeResult> => {
  const monthStart = monthPeriodKey(command.now);
  const dayStart = dayPeriodKey(command.now);

  // 1. Take the account's lock. Everything below runs alone for this account.
  await ensureAccountMonthRow(client, command.accountId, monthStart);
  await lockAccountMonth(client, command.accountId, monthStart);

  // 2. A duplicate may have committed while we waited for the lock.
  const raced = await findRequest(client, command.accountId, command.requestId);
  if (raced !== null) {
    return replayOrConflict(raced, fingerprint);
  }

  // 3. Read the plans and usage as they are right now.
  const plans = await loadEffectivePlans(
    client,
    command.accountId,
    command.userId,
  );
  if (plans === null) {
    throw new Error(
      "The user disappeared during a consume call, which should be impossible",
    );
  }
  const usage = await readUsage(client, {
    accountId: command.accountId,
    userId: plans.userInternalId,
    monthStart,
    dayStart,
  });

  // 4. Decide. This is the pure engine: no I/O, no clock.
  const context: EvaluationContext = {
    requested: command.units,
    account: { plan: plans.accountPlan, usage: usage.account },
    user: { plan: plans.userPlan, usage: usage.user },
  };
  const decision = evaluate(context);
  const stored = buildStoredDecision({
    requestId: command.requestId,
    userId: command.userId,
    units: command.units,
    now: command.now,
    decision,
    account: context.account,
    user: context.user,
  });

  // 5. Record the outcome (accepted or rejected), and count the units only if accepted.
  await insertRequest(client, {
    accountId: command.accountId,
    userInternalId: plans.userInternalId,
    requestId: command.requestId,
    units: command.units,
    fingerprint,
    outcome: stored.accepted ? "accepted" : "rejected",
    decision: stored,
    periodMonth: monthStart,
  });
  if (decision.kind === "accepted") {
    await recordAccountUsage(client, {
      accountId: command.accountId,
      monthStart,
      dayStart,
      units: decision.units,
    });
    await recordUserUsage(client, {
      userId: plans.userInternalId,
      monthStart,
      dayStart,
      units: decision.units,
    });
  }

  return ok({ ...stored, replayed: false });
};

export const consume = async (
  pool: pg.Pool,
  command: ConsumeCommand,
): Promise<ConsumeResult> => {
  const fingerprint = fingerprintOf(command.userId, command.units);

  // no locks: retries and unknown users are answered cheaply.
  const existing = await findRequest(
    pool,
    command.accountId,
    command.requestId,
  );
  if (existing !== null) {
    return replayOrConflict(existing, fingerprint);
  }
  if (!(await userExists(pool, command.accountId, command.userId))) {
    return err("user_not_found");
  }

  // one transaction. It uses its own client, never the pool, so a pile of waiting
  // transactions cannot starve themselves of connections.
  return withTransaction(pool, (client) =>
    decideInTransaction(client, command, fingerprint),
  );
};

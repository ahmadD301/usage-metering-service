import type pg from "pg";
import {
  dayPeriodKey,
  evaluate,
  monthPeriodKey,
  type EvaluationContext,
} from "../domain/index.js";
import { withTransaction } from "../db/client.js";
import {
  loadConsumeState,
  lockAccountForConsume,
  precheck,
  recordOutcome,
} from "../db/consume-state.js";
import type { StoredRequest } from "../db/requests.js";
import { err, ok, type Result } from "../shared/result.js";
import { buildStoredDecision } from "./decision.js";
import { fingerprintOf } from "./fingerprint.js";
import type { ConsumeCommand, ConsumeError, ConsumeResponse } from "./types.js";

type ConsumeResult = Result<ConsumeResponse, ConsumeError>;

/**
 * Runs a task while holding a slot for `key`. Used to limit how many consume calls for one
 * account are in flight inside this process. It is an optimization only: correctness comes
 * from the database lock, so it stays correct with several service instances.
 */
export type Exclusive = <T>(key: string, task: () => Promise<T>) => Promise<T>;

const unrestricted: Exclusive = (_key, task) => task();

/** Same request id: same payload replays the stored decision, a different payload is a conflict. */
const replayOrConflict = (
  existing: StoredRequest,
  fingerprint: string,
): ConsumeResult =>
  existing.fingerprint === fingerprint
    ? ok({ ...existing.decision, replayed: true })
    : err("idempotency_conflict");

const decideInTransaction = async (
  client: pg.PoolClient,
  command: ConsumeCommand,
  fingerprint: string,
): Promise<ConsumeResult> => {
  const monthStart = monthPeriodKey(command.now);
  const dayStart = dayPeriodKey(command.now);

  // 1. Take the account's lock. Everything below runs alone for this account.
  await lockAccountForConsume(client, command.accountId, monthStart);

  // 2. One statement, started AFTER the lock, so it sees what the previous holder committed:
  //    an earlier decision for this request id, both plans and the four counters.
  const state = await loadConsumeState(client, {
    accountId: command.accountId,
    userId: command.userId,
    requestId: command.requestId,
    monthStart,
    dayStart,
  });
  if (state === null) {
    throw new Error(
      "The user disappeared during a consume call, which should be impossible",
    );
  }
  if (state.existing !== null) {
    return replayOrConflict(state.existing, fingerprint);
  }

  // 3. Decide. This is the pure engine: no I/O, no clock.
  const context: EvaluationContext = {
    requested: command.units,
    account: { plan: state.accountPlan, usage: state.usage.account },
    user: { plan: state.userPlan, usage: state.usage.user },
  };
  const stored = buildStoredDecision({
    requestId: command.requestId,
    userId: command.userId,
    units: command.units,
    now: command.now,
    decision: evaluate(context),
    account: context.account,
    user: context.user,
  });

  // 4. Record the outcome (accepted or rejected); counters change only if accepted.
  await recordOutcome(client, {
    accountId: command.accountId,
    userInternalId: state.userInternalId,
    requestId: command.requestId,
    units: command.units,
    fingerprint,
    decision: stored,
    monthStart,
    dayStart,
  });

  return ok({ ...stored, replayed: false });
};

const consumeNow = async (
  pool: pg.Pool,
  command: ConsumeCommand,
): Promise<ConsumeResult> => {
  const fingerprint = fingerprintOf(command.userId, command.units);

  // Phase 1, no locks: retries and unknown users are answered with one cheap query.
  const first = await precheck(pool, {
    accountId: command.accountId,
    userId: command.userId,
    requestId: command.requestId,
  });
  if (first.existing !== null) {
    return replayOrConflict(first.existing, fingerprint);
  }
  if (!first.userExists) {
    return err("user_not_found");
  }

  // Phase 2, one transaction. It uses its own client, never the pool, so a pile of waiting
  // transactions cannot starve themselves of connections.
  return withTransaction(pool, (client) =>
    decideInTransaction(client, command, fingerprint),
  );
};

export const consume = (
  pool: pg.Pool,
  command: ConsumeCommand,
  exclusive: Exclusive = unrestricted,
): Promise<ConsumeResult> =>
  exclusive(command.accountId, () => consumeNow(pool, command));

import type { StoredDecision } from "../consume/types.js";
import type { Plan, RuleConfig } from "../domain/index.js";
import type { Queryable } from "./client.js";
import type { StoredRequest } from "./requests.js";
import { ensureAccountMonthRow, toUsagePair, type UsagePair } from "./usage.js";

// ---------- before the transaction: one cheap read ----------

export type Precheck = {
  readonly existing: StoredRequest | null;
  readonly userExists: boolean;
};

type PrecheckRow = { request: StoredRequest | null; user_exists: boolean };

const PRECHECK_SQL = `
  SELECT
    (SELECT json_build_object('fingerprint', rq.fingerprint, 'decision', rq.decision)
     FROM requests rq WHERE rq.account_id = $1 AND rq.request_id = $3) AS request,
    EXISTS (SELECT 1 FROM users u WHERE u.account_id = $1 AND u.external_id = $2) AS user_exists
`;

/** No locks. Answers "was this request already decided?" and "does this user exist?" at once. */
export const precheck = async (
  db: Queryable,
  input: {
    readonly accountId: string;
    readonly userId: string;
    readonly requestId: string;
  },
): Promise<Precheck> => {
  const result = await db.query<PrecheckRow>(PRECHECK_SQL, [
    input.accountId,
    input.userId,
    input.requestId,
  ]);
  const [row] = result.rows;
  if (row === undefined) {
    throw new Error("The precheck query returned no row");
  }
  return { existing: row.request, userExists: row.user_exists };
};

// ---------- inside the transaction ----------

const LOCK_SQL = `
  SELECT 1 FROM account_usage
  WHERE account_id = $1 AND period_kind = 'month' AND period_start = $2::date
  FOR UPDATE
`;

const tryLock = async (
  db: Queryable,
  accountId: string,
  monthStart: string,
): Promise<boolean> => {
  const result = await db.query(LOCK_SQL, [accountId, monthStart]);
  return (result.rowCount ?? 0) > 0;
};

/**
 * Takes the account's lock. The counter row normally exists, so the common case is ONE statement.
 * Only the first request of a month creates the row (INSERT ... ON CONFLICT DO NOTHING, safe
 * when two requests race) and then locks it.
 *
 * This is a statement of its own on purpose. Everything read AFTER it starts a new statement,
 * and so gets a fresh snapshot that includes whatever the previous lock holder committed.
 */
export const lockAccountForConsume = async (
  db: Queryable,
  accountId: string,
  monthStart: string,
): Promise<void> => {
  if (await tryLock(db, accountId, monthStart)) {
    return;
  }
  await ensureAccountMonthRow(db, accountId, monthStart);
  if (!(await tryLock(db, accountId, monthStart))) {
    throw new Error(
      "The account month counter row is missing right after it was created",
    );
  }
};

export type ConsumeStateInput = {
  readonly accountId: string;
  /** The caller's own user identifier (users.external_id). */
  readonly userId: string;
  readonly requestId: string;
  /** "YYYY-MM-01" */
  readonly monthStart: string;
  /** "YYYY-MM-DD" */
  readonly dayStart: string;
};

export type ConsumeState = {
  /** A decision for this request id that committed while we waited for the lock, or null. */
  readonly existing: StoredRequest | null;
  readonly userInternalId: string;
  readonly accountPlan: Plan;
  readonly userPlan: Plan;
  readonly usage: UsagePair;
};

type CounterJson = { period_kind: "month" | "day"; units_used: number };

type StateRow = {
  request: StoredRequest | null;
  user_id: string;
  account_plan_id: string;
  account_plan_name: string;
  account_rules: RuleConfig[];
  user_plan_id: string;
  user_plan_name: string;
  user_rules: RuleConfig[];
  account_counters: CounterJson[];
  user_counters: CounterJson[];
};

const RULES = (planAlias: string): string => `
  COALESCE(
    (SELECT json_agg(json_build_object('kind', r.kind, 'limit', r.limit_value) ORDER BY r.kind)
     FROM plan_rules r WHERE r.plan_id = ${planAlias}.id),
    '[]'::json
  )`;

const STATE_SQL = `
  SELECT
    (SELECT json_build_object('fingerprint', rq.fingerprint, 'decision', rq.decision)
     FROM requests rq WHERE rq.account_id = $1 AND rq.request_id = $3) AS request,
    u.id AS user_id,
    ap.id AS account_plan_id, ap.name AS account_plan_name, ${RULES("ap")} AS account_rules,
    up.id AS user_plan_id, up.name AS user_plan_name, ${RULES("up")} AS user_rules,
    COALESCE(
      (SELECT json_agg(json_build_object('period_kind', au.period_kind, 'units_used', au.units_used))
       FROM account_usage au
       WHERE au.account_id = $1
         AND ((au.period_kind = 'month' AND au.period_start = $4::date)
           OR (au.period_kind = 'day' AND au.period_start = $5::date))),
      '[]'::json
    ) AS account_counters,
    COALESCE(
      (SELECT json_agg(json_build_object('period_kind', uu.period_kind, 'units_used', uu.units_used))
       FROM user_usage uu
       WHERE uu.user_id = u.id
         AND ((uu.period_kind = 'month' AND uu.period_start = $4::date)
           OR (uu.period_kind = 'day' AND uu.period_start = $5::date))),
      '[]'::json
    ) AS user_counters
  FROM users u
  JOIN accounts a ON a.id = u.account_id
  JOIN plans ap ON ap.id = a.plan_id
  JOIN plans up ON up.id = u.plan_id
  WHERE u.account_id = $1 AND u.external_id = $2
`;

/**
 * Everything the decision needs, in ONE statement: any earlier decision for this request id,
 * both plans with their rules, and the four counters. Call it only AFTER the account lock is
 * held, so its snapshot is taken after the previous lock holder committed.
 * Returns null if the user does not exist.
 */
export const loadConsumeState = async (
  db: Queryable,
  input: ConsumeStateInput,
): Promise<ConsumeState | null> => {
  const result = await db.query<StateRow>(STATE_SQL, [
    input.accountId,
    input.userId,
    input.requestId,
    input.monthStart,
    input.dayStart,
  ]);
  const [row] = result.rows;
  if (row === undefined) {
    return null;
  }
  return {
    existing: row.request,
    userInternalId: row.user_id,
    accountPlan: {
      id: row.account_plan_id,
      name: row.account_plan_name,
      scope: "account",
      rules: row.account_rules,
    },
    userPlan: {
      id: row.user_plan_id,
      name: row.user_plan_name,
      scope: "user",
      rules: row.user_rules,
    },
    usage: toUsagePair([
      ...row.account_counters.map((counter) => ({
        owner: "account" as const,
        ...counter,
      })),
      ...row.user_counters.map((counter) => ({
        owner: "user" as const,
        ...counter,
      })),
    ]),
  };
};

export type OutcomeInput = {
  readonly accountId: string;
  readonly userInternalId: string;
  readonly requestId: string;
  /** The units that were asked for. */
  readonly units: number;
  readonly fingerprint: string;
  readonly decision: StoredDecision;
  /** "YYYY-MM-01" */
  readonly monthStart: string;
  /** "YYYY-MM-DD" */
  readonly dayStart: string;
};

/**
 * Records the request, and, only if it was accepted, adds the units to all four counters.
 * One statement: data-modifying CTEs all run exactly once, and all-or-nothing together.
 */
const RECORD_SQL = `
  WITH req AS (
    INSERT INTO requests
      (account_id, user_id, request_id, units, fingerprint, outcome, decision, period_month, created_at)
    VALUES ($1::uuid, $2::uuid, $3, $4::bigint, $5, $6, $7::jsonb, $8::date, clock_timestamp())
  ),
  account_counters AS (
    INSERT INTO account_usage (account_id, period_kind, period_start, units_used)
    SELECT $1::uuid, c.kind, c.period_start, $4::bigint
    FROM (VALUES ('month', $8::date), ('day', $9::date)) AS c(kind, period_start)
    WHERE $10::boolean
    ON CONFLICT (account_id, period_kind, period_start)
    DO UPDATE SET units_used = account_usage.units_used + EXCLUDED.units_used, updated_at = now()
  ),
  user_counters AS (
    INSERT INTO user_usage (user_id, period_kind, period_start, units_used)
    SELECT $2::uuid, c.kind, c.period_start, $4::bigint
    FROM (VALUES ('month', $8::date), ('day', $9::date)) AS c(kind, period_start)
    WHERE $10::boolean
    ON CONFLICT (user_id, period_kind, period_start)
    DO UPDATE SET units_used = user_usage.units_used + EXCLUDED.units_used, updated_at = now()
  )
  SELECT 1
`;

export const recordOutcome = async (
  db: Queryable,
  input: OutcomeInput,
): Promise<void> => {
  await db.query(RECORD_SQL, [
    input.accountId,
    input.userInternalId,
    input.requestId,
    input.units,
    input.fingerprint,
    input.decision.accepted ? "accepted" : "rejected",
    JSON.stringify(input.decision),
    input.monthStart,
    input.dayStart,
    input.decision.accepted,
  ]);
};

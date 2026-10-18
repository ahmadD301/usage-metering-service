// the simulated “document processing” business action.
// It sends one unit per page and reacts only to the decision.
// It never knows which plan applies, so a plan change alters its behavior with no code change.

import type { ClientError } from "./http.js";
import type { MeteringClient } from "./metering-client.js";
import type { ConsumeResponse, Violation } from "./schemas.js";

export type DocumentOutcome =
  | {
      readonly kind: "processed";
      readonly pages: number;
      readonly replayed: boolean;
      readonly decision: ConsumeResponse;
    }
  | {
      readonly kind: "rejected";
      readonly pages: number;
      readonly reason: Violation;
      readonly decision: ConsumeResponse;
    }
  | { readonly kind: "failed"; readonly error: ClientError };

export type ProcessInput = {
  readonly userId: string;
  readonly pages: number;
  /** Chosen once by the caller. Every retry of this call reuses it, which is what makes retries safe. */
  readonly requestId: string;
};

export const processDocument = async (
  client: MeteringClient,
  input: ProcessInput,
): Promise<DocumentOutcome> => {
  const result = await client.consume({
    userId: input.userId,
    requestId: input.requestId,
    units: input.pages,
  });
  if (result.type !== "ok") {
    return { kind: "failed", error: result.error };
  }
  const decision = result.value;
  if (decision.accepted) {
    // The real work would run here.
    return {
      kind: "processed",
      pages: input.pages,
      replayed: decision.replayed,
      decision,
    };
  }
  return decision.reason === null
    ? {
        kind: "failed",
        error: {
          kind: "invalid_response",
          message: "The service rejected the request without a reason",
        },
      }
    : {
        kind: "rejected",
        pages: input.pages,
        reason: decision.reason.primary,
        decision,
      };
};

const RULE_LABELS: Readonly<Record<Violation["rule"], string>> = {
  max_per_request: "per-request limit",
  monthly_allowance: "monthly allowance",
  daily_allowance: "daily allowance",
};

const left = (value: number | null): string =>
  value === null ? "unlimited" : String(value);

export const describeViolation = (violation: Violation): string => {
  const used =
    violation.used === null ? "" : `used ${String(violation.used)}, `;
  return (
    `${violation.level} ${RULE_LABELS[violation.rule]} ` +
    `(limit ${String(violation.limit)}, ${used}${String(violation.remaining)} left, ` +
    `asked ${String(violation.requested)})`
  );
};

export const describeClientError = (error: ClientError): string => {
  switch (error.kind) {
    case "api":
      return `${error.code} (HTTP ${String(error.status)}): ${error.message}`;
    case "network":
    case "timeout":
    case "invalid_response":
      return `${error.kind}: ${error.message}`;
  }
};

export const summarizeOutcome = (
  outcome: DocumentOutcome,
  who: string,
): string => {
  switch (outcome.kind) {
    case "processed": {
      const { remaining } = outcome.decision;
      const head = outcome.replayed
        ? `REPLAYED, not counted again: ${who} had already processed ${String(outcome.pages)} page(s).`
        : `ACCEPTED: ${who} processed ${String(outcome.pages)} page(s).`;
      return (
        `${head} Left this month: ${who} ${left(remaining.user.monthlyAllowance)}, ` +
        `account ${left(remaining.account.monthlyAllowance)}.`
      );
    }
    case "rejected":
      return `REJECTED: ${who} asked for ${String(outcome.pages)} page(s). Blocked by the ${describeViolation(outcome.reason)}.`;
    case "failed":
      return `FAILED: ${describeClientError(outcome.error)}`;
  }
};

import type { Units, Violation } from "../domain/index.js";
import type { RemainingSummary } from "../domain/usage.js";

export type PlanRef = { readonly id: string; readonly name: string };

export type StoredDecision = {
  readonly requestId: string;

  readonly userId: string;
  readonly units: number;
  readonly accepted: boolean;

  readonly reason: {
    readonly primary: Violation;
    readonly violations: readonly Violation[];
  } | null;

  readonly plans: { readonly account: PlanRef; readonly user: PlanRef };

  readonly remaining: {
    readonly account: RemainingSummary;
    readonly user: RemainingSummary;
  };
  readonly decidedAt: string;
};

export type ConsumeResponse = StoredDecision & { readonly replayed: boolean };

export type ConsumeError = "user_not_found" | "idempotency_conflict";

export type ConsumeCommand = {
  readonly accountId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly units: Units;
  readonly now: Date;
};

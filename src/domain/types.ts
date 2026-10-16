//these types define the structure of a usage-limiting engine,
// but they do not implement the actual limit checks

export type Units = number & { readonly __brand: "Units" };

export type Level = "account" | "user";

export const RULE_KINDS = [
  "max_per_request",
  "monthly_allowance",
  "daily_allowance",
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type RuleConfig = {
  readonly kind: RuleKind;
  readonly limit: number;
};

export type Plan = {
  readonly id: string;
  readonly name: string;
  readonly scope: Level;
  readonly rules: readonly RuleConfig[];
};

export type UsageSnapshot = {
  readonly monthUsed: number;
  readonly dayUsed: number;
};

export type LevelState = {
  readonly plan: Plan;
  readonly usage: UsageSnapshot;
};

export type EvaluationContext = {
  readonly requested: Units;
  readonly account: LevelState;
  readonly user: LevelState;
};

export type Violation = {
  readonly level: Level;
  readonly rule: RuleKind;
  readonly limit: number;
  readonly used: number | null;
  readonly remaining: number;
  readonly requested: number;
};

//The request can either be accepted or rejected.

export type Decision =
  | {
      readonly kind: "accepted";
      readonly units: Units;
    }
  | {
      readonly kind: "rejected";

      // The first violation in the list
      readonly primary: Violation;

      // A rejected request must have at least one violation
      readonly violations: readonly [Violation, ...Violation[]];
    };

export type RuleInput = {
  readonly requested: Units;
  readonly usage: UsageSnapshot;
};

// A rule is a pure function
export type Rule = (input: RuleInput) => Violation | null;

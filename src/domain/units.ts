import { err, ok, type Result } from "../shared/result.js";
import type { Units } from "./types.js";

export const MAX_UNITS_PER_REQUEST = 1_000_000_000;

export type UnitsError = "not_a_positive_integer" | "too_large";

export const parseUnits = (input: unknown): Result<Units, UnitsError> => {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 1) {
    return err("not_a_positive_integer");
  }
  if (input > MAX_UNITS_PER_REQUEST) {
    return err("too_large");
  }
  return ok(input as Units);
};

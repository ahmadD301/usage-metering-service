import { err, ok } from "../shared/result.js";
export const MAX_UNITS_PER_REQUEST = 1_000_000_000;
export const parseUnits = (input) => {
    if (typeof input !== "number" || !Number.isInteger(input) || input < 1) {
        return err("not_a_positive_integer");
    }
    if (input > MAX_UNITS_PER_REQUEST) {
        return err("too_large");
    }
    return ok(input);
};

import type { z } from "zod";
import { httpErrors } from "./errors.js";

export const parseWith = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw httpErrors.validation(
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
};
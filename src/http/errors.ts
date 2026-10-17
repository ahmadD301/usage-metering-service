import type { FastifyReply, FastifyRequest } from "fastify";
import type { Level } from "../domain/index.js";
import type { PlanLookupError, PlanUpdateError } from "../db/plans.js";
import { assertNever } from "../shared/assert-never.js";

export type ErrorCode =
  | "validation_error"
  | "bad_request"
  | "missing_api_key"
  | "invalid_api_key"
  | "admin_unauthorized"
  | "not_found"
  | "user_not_found"
  | "plan_not_found"
  | "plan_scope_mismatch"
  | "plan_read_only"
  | "user_already_exists"
  | "plan_name_taken"
  | "idempotency_conflict"
  | "not_ready"
  | "internal_error";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const httpErrors = {
  validation: (details: unknown): AppError =>
    new AppError(400, "validation_error", "Request validation failed", details),
  missingApiKey: (): AppError =>
    new AppError(
      401,
      "missing_api_key",
      "Send your API key in the X-API-Key header",
    ),
  invalidApiKey: (): AppError =>
    new AppError(
      401,
      "invalid_api_key",
      "The API key is invalid or has been revoked",
    ),
  adminUnauthorized: (): AppError =>
    new AppError(
      401,
      "admin_unauthorized",
      "A valid X-Admin-Token header is required",
    ),
  userNotFound: (): AppError =>
    new AppError(404, "user_not_found", "No such user in this account"),
  planNotFound: (): AppError =>
    new AppError(404, "plan_not_found", "No such plan"),
  planScopeMismatch: (expected: Level): AppError =>
    new AppError(
      422,
      "plan_scope_mismatch",
      `This operation needs a ${expected}-scope plan`,
    ),
  planReadOnly: (): AppError =>
    new AppError(403, "plan_read_only", "Predefined plans are read-only"),
  userAlreadyExists: (): AppError =>
    new AppError(
      409,
      "user_already_exists",
      "A user with this externalId already exists",
    ),
  planNameTaken: (): AppError =>
    new AppError(
      409,
      "plan_name_taken",
      "This account already has a plan with that name",
    ),
  idempotencyConflict: (): AppError =>
    new AppError(
      409,
      "idempotency_conflict",
      "This requestId was already used with a different userId or units. Use a new requestId.",
    ),
  notReady: (): AppError =>
    new AppError(503, "not_ready", "The database is not reachable"),
};

export const fromPlanLookupError = (
  error: PlanLookupError,
  expectedScope: Level,
): AppError =>
  error === "plan_not_found"
    ? httpErrors.planNotFound()
    : httpErrors.planScopeMismatch(expectedScope);

export const fromPlanUpdateError = (error: PlanUpdateError): AppError => {
  switch (error) {
    case "plan_not_found":
      return httpErrors.planNotFound();
    case "plan_read_only":
      return httpErrors.planReadOnly();
    case "name_taken":
      return httpErrors.planNameTaken();
    default:
      return assertNever(error);
  }
};

const errorBody = (
  code: string,
  message: string,
  details?: unknown,
): object => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

const statusOf = (error: Error): number =>
  "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : 500;

export const errorHandler = (
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply => {
  if (error instanceof AppError) {
    return reply
      .status(error.statusCode)
      .send(errorBody(error.code, error.message, error.details));
  }
  const status = statusOf(error);
  if (status >= 400 && status < 500) {
    // Framework-level client errors: invalid JSON, payload too large, unsupported media type.
    return reply.status(status).send(errorBody("bad_request", error.message));
  }
  request.log.error(error);
  return reply
    .status(500)
    .send(errorBody("internal_error", "Something went wrong"));
};

export const notFoundHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply =>
  reply
    .status(404)
    .send(
      errorBody(
        "not_found",
        `Route ${request.method} ${request.url} does not exist`,
      ),
    );

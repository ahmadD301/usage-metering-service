import { z } from "zod";
import { assertNever } from "../src/shared/assert-never.js";
import { err, ok, type Result } from "../src/shared/result.js";

export type ClientError =
  | {
      readonly kind: "api";
      readonly status: number;
      readonly code: string;
      readonly message: string;
      readonly details?: unknown;
    }
  | { readonly kind: "network"; readonly message: string }
  | { readonly kind: "timeout"; readonly message: string }
  | { readonly kind: "invalid_response"; readonly message: string };

/** Narrow on purpose: the global fetch satisfies it, and test stubs are easy to write. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type HttpOptions = {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly fetchFn: FetchFn;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
};

export type RequestSpec<T> = {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;

  readonly retry: boolean;
};

export type HttpCall = <T>(
  spec: RequestSpec<T>,
) => Promise<Result<T, ClientError>>;

const errorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const backoffDelayMs = (
  attempt: number,
  random: () => number,
  baseMs = 100,
  capMs = 2_000,
): number => Math.floor(random() * Math.min(capMs, baseMs * 2 ** attempt));

export const isRetryable = (error: ClientError): boolean => {
  switch (error.kind) {
    case "network":
    case "timeout":
      return true;
    case "api":
      return error.status === 429 || error.status >= 500;
    case "invalid_response":
      return false;
    default:
      return assertNever(error);
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const toApiError = (status: number, payload: unknown): ClientError => {
  const parsed = errorBody.safeParse(payload);
  if (!parsed.success) {
    return {
      kind: "api",
      status,
      code: "http_error",
      message: `HTTP ${String(status)}`,
    };
  }
  const { code, message, details } = parsed.data.error;
  return {
    kind: "api",
    status,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
};

const describeFailure = (cause: unknown): ClientError => {
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return {
      kind: "timeout",
      message: "The request timed out",
    };
  }

  return {
    kind: "network",
    message: cause instanceof Error ? cause.message : String(cause),
  };
};

export const createHttp = (options: HttpOptions): HttpCall => {
  // One request. Never throws: every failure becomes a ClientError.
  const attemptOnce = async <T>(
    spec: RequestSpec<T>,
  ): Promise<Result<T, ClientError>> => {
    const hasBody = spec.body !== undefined;
    try {
      const response = await options.fetchFn(`${options.baseUrl}${spec.path}`, {
        method: spec.method,
        headers: {
          accept: "application/json",
          ...(hasBody ? { "content-type": "application/json" } : {}),
          ...spec.headers,
        },
        ...(hasBody ? { body: JSON.stringify(spec.body) } : {}),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const payload = parseJson(await response.text());
      if (!response.ok) {
        return err<ClientError>(toApiError(response.status, payload));
      }
      const parsed = spec.schema.safeParse(payload);
      return parsed.success
        ? ok(parsed.data)
        : err<ClientError>({
            kind: "invalid_response",
            message: `Unexpected response shape: ${parsed.error.issues[0]?.message ?? "unknown"}`,
          });
    } catch (cause) {
      return err<ClientError>(describeFailure(cause));
    }
  };

  const run = async <T>(
    spec: RequestSpec<T>,
    attempt: number,
  ): Promise<Result<T, ClientError>> => {
    const result = await attemptOnce(spec);
    const canRetry = spec.retry && attempt < options.maxRetries;
    if (result.type === "ok" || !canRetry || !isRetryable(result.error)) {
      return result;
    }
    await options.sleep(backoffDelayMs(attempt, options.random));
    return run(spec, attempt + 1);
  };

  return <T>(spec: RequestSpec<T>) => run(spec, 0);
};

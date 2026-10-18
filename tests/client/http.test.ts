import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  backoffDelayMs,
  isRetryable,
  type ClientError,
  type RequestSpec,
} from "../../client/http.js";
import type { Result } from "../../src/shared/result.js";
import { harness, json } from "../helpers/http-stub.js";

type Pong = { pong: boolean };

const spec = (
  overrides: Partial<RequestSpec<Pong>> = {},
): RequestSpec<Pong> => ({
  method: "POST",
  path: "/ping",
  body: { n: 1 },
  schema: z.object({ pong: z.boolean() }),
  retry: true,
  ...overrides,
});

const unavailable = () =>
  json(503, { error: { code: "unavailable", message: "try later" } });

const pong = () => json(200, { pong: true });

const errorOf = (result: Result<Pong, ClientError>): ClientError => {
  if (result.type === "ok") {
    throw new Error("expected an error result");
  }

  return result.error;
};

describe("createHttp", () => {
  it("sends a JSON request and returns the parsed response", async () => {
    const { http, calls } = harness([pong]);
    const result = await http(spec({ headers: { "x-api-key": "k" } }));

    expect(result).toEqual({ type: "ok", value: { pong: true } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://svc/ping");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(JSON.stringify({ n: 1 }));
    expect(calls[0]?.init.headers).toMatchObject({
      "content-type": "application/json",
      "x-api-key": "k",
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries a 503 and sends the identical body again", async () => {
    const { http, calls, sleeps } = harness([unavailable, pong]);
    const result = await http(spec());

    expect(result.type === "ok").toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init.body).toBe(calls[0]?.init.body);
    expect(sleeps).toEqual([backoffDelayMs(0, () => 0.5)]);
  });

  it("gives up after maxRetries and returns the last error", async () => {
    const { http, calls, sleeps } = harness([unavailable], 2);
    const error = errorOf(await http(spec()));

    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(error).toMatchObject({
      kind: "api",
      status: 503,
      code: "unavailable",
    });
  });

  it.each([400, 401, 404, 409, 422])("does not retry a %i", async (status) => {
    const { http, calls } = harness([
      () => json(status, { error: { code: "nope", message: "no" } }),
    ]);
    const error = errorOf(await http(spec()));

    expect(calls).toHaveLength(1);
    expect(error).toMatchObject({
      kind: "api",
      status,
      code: "nope",
    });
  });

  it("does not retry when the call is not marked safe to repeat", async () => {
    const { http, calls } = harness([unavailable]);

    await http(spec({ retry: false }));

    expect(calls).toHaveLength(1);
  });

  it("retries a network error", async () => {
    const { http, calls } = harness([
      () => {
        throw new Error("connection reset");
      },
      pong,
    ]);

    expect((await http(spec())).type === "ok").toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("reports a timeout as its own error kind", async () => {
    const { http } = harness(
      [
        () => {
          throw Object.assign(new Error("aborted"), {
            name: "TimeoutError",
          });
        },
      ],
      0,
    );

    expect(errorOf(await http(spec())).kind).toBe("timeout");
  });

  it("rejects a response with the wrong shape without retrying", async () => {
    const { http, calls } = harness([() => json(200, { nope: 1 })]);
    const error = errorOf(await http(spec()));

    expect(error.kind).toBe("invalid_response");
    expect(calls).toHaveLength(1);
  });

  it("copes with a non-JSON error body", async () => {
    const { http } = harness([() => new Response("oops", { status: 500 })], 0);

    expect(errorOf(await http(spec()))).toMatchObject({
      kind: "api",
      status: 500,
      code: "http_error",
    });
  });
});

describe("retry policy helpers", () => {
  it("backs off exponentially with full jitter, capped", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(0);
    expect(backoffDelayMs(0, () => 0.999)).toBe(99);
    expect(backoffDelayMs(3, () => 0.5)).toBe(400);
    expect(backoffDelayMs(20, () => 0.999)).toBe(1_998);
  });

  it("retries only transient failures", () => {
    expect(isRetryable({ kind: "network", message: "x" })).toBe(true);
    expect(isRetryable({ kind: "timeout", message: "x" })).toBe(true);
    expect(
      isRetryable({ kind: "api", status: 429, code: "c", message: "m" }),
    ).toBe(true);
    expect(
      isRetryable({ kind: "api", status: 500, code: "c", message: "m" }),
    ).toBe(true);
    expect(
      isRetryable({ kind: "api", status: 404, code: "c", message: "m" }),
    ).toBe(false);
    expect(isRetryable({ kind: "invalid_response", message: "x" })).toBe(false);
  });
});

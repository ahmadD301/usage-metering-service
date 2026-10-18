import { createHttp, type FetchFn, type HttpCall } from "../../client/http.js";

export type Step = () => Response;

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export type RecordedCall = { readonly url: string; readonly init: RequestInit };

export const harness = (
  steps: readonly Step[],
  maxRetries = 2,
): { http: HttpCall; calls: RecordedCall[]; sleeps: number[] } => {
  const calls: RecordedCall[] = [];
  const sleeps: number[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === undefined) {
      throw new Error("The stub has no steps");
    }
    return step();
  };
  const http = createHttp({
    baseUrl: "http://svc",
    timeoutMs: 1_000,
    maxRetries,
    fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
  return { http, calls, sleeps };
};

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import { err, ok, type Result } from "../src/shared/result.js";
import {
  describeClientError,
  processDocument,
  summarizeOutcome,
} from "./documents.js";
import type { ClientError, HttpCall } from "./http.js";
import {
  createMeteringClient,
  type MeteringClient,
} from "./metering-client.js";
import { provisionAccount } from "./provisioning.js";
import {
  ALICE,
  BOB,
  readState,
  runScenario,
  setupDemoAccount,
  type DemoAccount,
} from "./scenario.js";
import { pageHtml } from "./web/page.js";
import { Buffer } from "node:buffer";

export type DemoDeps = {
  readonly http: HttpCall;
  readonly adminToken: string;
  readonly newId: () => string;
};

type Session = { readonly client: MeteringClient; readonly demo: DemoAccount };

const user = z.enum([ALICE, BOB]);
const processBody = z.object({
  user,
  pages: z.number().int().min(1).max(10_000),
});
const switchBody = z.object({ user, plan: z.enum(["Basic", "Premium"]) });

const MAX_BODY_BYTES = 4_096;

const sendJson = (
  res: ServerResponse,
  status: number,
  payload: unknown,
): void => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
};

const sendClientError = (res: ServerResponse, error: ClientError): void => {
  sendJson(res, 502, { error: describeClientError(error) });
};

const readJsonBody = async (
  req: IncomingMessage,
): Promise<Result<unknown, string>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      return err("Request body is too large");
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    return ok(undefined);
  }
  try {
    return ok(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
  } catch {
    return err("Request body is not valid JSON");
  }
};

const parseBody = async <T>(
  req: IncomingMessage,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<Result<T, string>> => {
  const body = await readJsonBody(req);
  if (body.type !== "ok") {
    return err(body.error);
  }
  const parsed = schema.safeParse(body.value);
  return parsed.success ? ok(parsed.data) : err("Invalid request body");
};

export const createDemoServer = (deps: DemoDeps): Server => {
  let session: Session | null = null;

  /** Provisions a brand-new account and prepares it. The only place the admin token is used. */
  const newSession = async (): Promise<Result<Session, ClientError>> => {
    const provisioned = await provisionAccount(
      deps.http,
      deps.adminToken,
      `Demo ${deps.newId().slice(0, 8)}`,
    );
    if (provisioned.type !== "ok") {
      return err(provisioned.error);
    }
    const client = createMeteringClient(deps.http, provisioned.value.apiKey);
    const demo = await setupDemoAccount(client);
    if (demo.type !== "ok") {
      return err(demo.error);
    }
    session = { client, demo: demo.value };
    return ok(session);
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    switch (`${req.method ?? "GET"} ${path}`) {
      case "GET /":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(pageHtml);
        return;

      case "GET /health":
        sendJson(res, 200, { status: "ok" });
        return;

      case "GET /api/state": {
        if (session === null) {
          sendJson(res, 200, { state: null });
          return;
        }
        const state = await readState(session.client);
        if (state.type !== "ok") {
          sendClientError(res, state.error);
          return;
        }
        sendJson(res, 200, { state: state.value });
        return;
      }

      case "POST /api/new-account": {
        const created = await newSession();
        if (created.type !== "ok") {
          sendClientError(res, created.error);
          return;
        }
        const state = await readState(created.value.client);
        sendJson(res, 200, { state: state.type === "ok" ? state.value : null });
        return;
      }

      case "POST /api/scenario": {
        const created = await newSession();
        if (created.type !== "ok") {
          sendClientError(res, created.error);
          return;
        }
        const steps = await runScenario(
          created.value.client,
          created.value.demo,
        );
        const state = await readState(created.value.client);
        sendJson(res, 200, {
          steps: steps.map(({ title, expected, passed, summary }) => ({
            title,
            expected,
            passed,
            summary,
          })),
          allPassed: steps.every((step) => step.passed),
          state: state.type === "ok" ? state.value : null,
        });
        return;
      }

      case "POST /api/process": {
        const body = await parseBody(req, processBody);
        if (body.type !== "ok") {
          sendJson(res, 400, { error: body.error });
          return;
        }
        if (session === null) {
          sendJson(res, 409, { error: "Create a demo account first" });
          return;
        }
        const outcome = await processDocument(session.client, {
          userId: body.value.user,
          pages: body.value.pages,
          requestId: deps.newId(),
        });
        const state = await readState(session.client);
        sendJson(res, 200, {
          summary: summarizeOutcome(outcome, body.value.user),
          accepted: outcome.kind === "processed",
          state: state.type === "ok" ? state.value : null,
        });
        return;
      }

      case "POST /api/switch": {
        const body = await parseBody(req, switchBody);
        if (body.type !== "ok") {
          sendJson(res, 400, { error: body.error });
          return;
        }
        if (session === null) {
          sendJson(res, 409, { error: "Create a demo account first" });
          return;
        }
        const planId =
          body.value.plan === "Basic"
            ? session.demo.basicPlanId
            : session.demo.premiumPlanId;
        const switched = await session.client.setUserPlan(
          body.value.user,
          planId,
        );
        if (switched.type !== "ok") {
          sendClientError(res, switched.error);
          return;
        }
        const state = await readState(session.client);
        sendJson(res, 200, { state: state.type === "ok" ? state.value : null });
        return;
      }

      default:
        sendJson(res, 404, { error: "Not found" });
    }
  };

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Something went wrong" });
      } else {
        res.end();
      }
    });
  });
};

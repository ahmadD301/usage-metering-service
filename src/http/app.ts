import Fastify, { type FastifyInstance } from "fastify";
import type { AppDeps } from "./deps.js";
import { errorHandler, httpErrors, notFoundHandler } from "./errors.js";
import { accountRoutes } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";

export const buildApp = (deps: AppDeps): FastifyInstance => {
  const app = Fastify({ logger: deps.logger ?? false });

  app.decorateRequest("account", null);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // Liveness: the process is up. Readiness: the database answers.
  app.get("/health", (_request, reply) => reply.send({ status: "ok" }));
  app.get("/ready", async () => {
    try {
      await deps.pool.query("SELECT 1");
    } catch {
      throw httpErrors.notReady();
    }
    return { status: "ready" };
  });

  void app.register(adminRoutes(deps));
  void app.register(accountRoutes(deps));

  return app;
};
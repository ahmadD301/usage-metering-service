import { randomUUID } from "node:crypto";
import { loadClientConfig } from "./config.js";
import { createHttpFor } from "./metering-client.js";
import { createDemoServer } from "./server.js";

const config = loadClientConfig(process.env);
const http = createHttpFor({
  baseUrl: config.meteringUrl,
  timeoutMs: config.requestTimeoutMs,
  maxRetries: config.maxRetries,
});

const server = createDemoServer({
  http,
  adminToken: config.adminToken,
  newId: randomUUID,
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(
    `Demo client listening on port ${String(config.port)}, talking to ${config.meteringUrl}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}

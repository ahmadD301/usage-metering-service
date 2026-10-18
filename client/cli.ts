import { loadClientConfig } from "./config.js";
import { describeClientError } from "./documents.js";
import { createHttpFor, createMeteringClient } from "./metering-client.js";
import { provisionAccount } from "./provisioning.js";
import { readState, runScenario, setupDemoAccount } from "./scenario.js";

const main = async (): Promise<number> => {
  const config = loadClientConfig(process.env);
  const http = createHttpFor({
    baseUrl: config.meteringUrl,
    timeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
  });

  const provisioned = await provisionAccount(
    http,
    config.adminToken,
    `CLI demo ${new Date().toISOString()}`,
  );
  if (!provisioned.ok) {
    console.error(
      `Could not create a demo account: ${describeClientError(provisioned.error)}`,
    );
    return 1;
  }
  const client = createMeteringClient(http, provisioned.value.apiKey);
  const demo = await setupDemoAccount(client);
  if (!demo.ok) {
    console.error(
      `Could not prepare the demo account: ${describeClientError(demo.error)}`,
    );
    return 1;
  }

  const steps = await runScenario(client, demo.value);
  for (const step of steps) {
    console.log(`${step.passed ? "[ OK ]" : "[FAIL]"} ${step.title}`);
    console.log(`       expected: ${step.expected}`);
    console.log(`       ${step.summary}`);
  }

  const state = await readState(client);
  if (state.ok) {
    console.log(
      `\nAccount (${state.value.accountPlan}): used ${String(state.value.accountConsumed)}`,
    );
    for (const user of state.value.users) {
      console.log(
        `  ${user.name} (${user.planName}): used ${String(user.consumedThisMonth)}`,
      );
    }
  }
  return steps.every((step) => step.passed) ? 0 : 1;
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

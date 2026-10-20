import { loadConfig } from "./config.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import { createPool } from "./db/client.js";
import { buildApp } from "./http/app.js";

const main = async (): Promise<void> => {
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl, { max: config.dbPoolMax });

  const { appliedMigrations } = await bootstrapDatabase(pool, config.migrationsDir);
  const app = buildApp({
    pool,
    adminToken: config.adminToken,
    logger: true,
    accountConcurrency: config.accountConcurrency,
  });
  app.log.info(
    {
      appliedMigrations,
      dbPoolMax: config.dbPoolMax,
      accountConcurrency: config.accountConcurrency,
    },
    "database ready",
  );

  const shutdown = async (): Promise<void> => {
    await app.close();
    await pool.end();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      shutdown().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
    });
  }

  await app.listen({ port: config.port, host: config.host });
};
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

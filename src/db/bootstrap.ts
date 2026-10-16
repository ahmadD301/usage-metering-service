import type pg from "pg";
import { runMigrations } from "./migrate.js";
import { seedPredefinedPlans } from "./seed.js";

export type BootstrapResult = { readonly appliedMigrations: readonly string[] };

export const bootstrapDatabase = async (
  pool: pg.Pool,
  migrationsDir: string,
): Promise<BootstrapResult> => {
  const appliedMigrations = await runMigrations(pool, migrationsDir);
  await seedPredefinedPlans(pool);
  return { appliedMigrations };
};

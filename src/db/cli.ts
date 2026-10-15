import path from "node:path";
import { bootstrapDatabase } from "./bootstrap.js";
import { createPool } from "./client.js";

const main = async (): Promise<void> => {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is required, e.g. postgres://user:password@localhost:5432/db");
  }
  const migrationsDir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "migrations");

  const pool = createPool(connectionString);
  try {
    const { appliedMigrations } = await bootstrapDatabase(pool, migrationsDir);
    console.log(
      appliedMigrations.length === 0
        ? "Database already up to date"
        : `Applied migrations: ${appliedMigrations.join(", ")}`,
    );
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

// run npm run db:setup by hand. 
// The migrations folder defaults to 
// ./migrations relative to where you run it
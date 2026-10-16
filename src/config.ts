import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(16, "must be at least 16 characters"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  MIGRATIONS_DIR: z.string().min(1).optional(),
});

export type Config = {
  readonly databaseUrl: string;
  readonly adminToken: string;
  readonly port: number;
  readonly host: string;
  readonly migrationsDir: string;
};

export const loadConfig = (env: Readonly<Record<string, string | undefined>>): Config => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const values = parsed.data;
  return {
    databaseUrl: values.DATABASE_URL,
    adminToken: values.ADMIN_TOKEN,
    port: values.PORT,
    host: values.HOST,
    migrationsDir: values.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "migrations"),
  };
};

// Reads and validates environment variables once at startup. 
// The service refuses to start with a missing database URL or a weak admin token.
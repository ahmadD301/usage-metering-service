import { z } from "zod";

const envSchema = z.object({
  METERING_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_TOKEN: z.string().min(16, "must be at least 16 characters"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(5_000),
  MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
});

export type ClientConfig = {
  readonly meteringUrl: string;
  readonly adminToken: string;
  readonly port: number;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
};

const withoutEmpty = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[1] !== "",
    ),
  );

export const loadClientConfig = (
  env: Readonly<Record<string, string | undefined>>,
): ClientConfig => {
  const parsed = envSchema.safeParse(withoutEmpty(env));
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid client configuration: ${problems}`);
  }
  const values = parsed.data;
  return {
    meteringUrl: values.METERING_URL.replace(/\/+$/, ""),
    adminToken: values.ADMIN_TOKEN,
    port: values.PORT,
    requestTimeoutMs: values.REQUEST_TIMEOUT_MS,
    maxRetries: values.MAX_RETRIES,
  };
};

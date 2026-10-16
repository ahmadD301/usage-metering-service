// API key generation and hashing. A key looks like mk_<8 hex>_<43 chars>
import { createHash, randomBytes } from "node:crypto";

export const hashApiKey = (key: string): string =>
  createHash("sha256").update(key).digest("hex");

//The full key. Shown to the caller exactly once and never stored.
export type GeneratedApiKey = {
  readonly key: string;
  readonly prefix: string;
  readonly hash: string;
};

export const generateApiKey = (): GeneratedApiKey => {
  const prefix = `mk_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  const key = `${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
};


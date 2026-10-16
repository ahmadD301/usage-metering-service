import { createHash } from "node:crypto";

// Key order is fixed, so equal payloads match
export const fingerprintOf = (userId: string, units: number): string =>
  createHash("sha256").update(JSON.stringify({ userId, units })).digest("hex");
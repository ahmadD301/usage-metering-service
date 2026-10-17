import { z } from "zod";
import type { HistoryCursor } from "../db/requests.js";
// encodes and decodes the opaque pagination cursor
//Postgres timestamptz text, e.g. "2026-10-16 12:34:56.123456+00". */
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

const cursorSchema = z.object({
  t: z.string().regex(TIMESTAMP_TEXT),
  id: z.string().uuid(),
});

export const encodeCursor = (cursor: HistoryCursor): string =>
  Buffer.from(JSON.stringify({ t: cursor.createdAt, id: cursor.id })).toString("base64url");

// Returns null for anything that is not a cursor we produced.
export const decodeCursor = (raw: string): HistoryCursor | null => {
  try {
    const json: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const parsed = cursorSchema.safeParse(json);
    return parsed.success ? { createdAt: parsed.data.t, id: parsed.data.id } : null;
  } catch {
    return null;
  }
};
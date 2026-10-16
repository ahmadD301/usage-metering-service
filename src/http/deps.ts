import type pg from "pg";

export type AppDeps = {
  readonly pool: pg.Pool;
  readonly adminToken: string;
  readonly logger?: boolean;
};
// what the app needs from the outside.

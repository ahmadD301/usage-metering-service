import type pg from "pg";

export type AppDeps = {
  readonly pool: pg.Pool;
  readonly adminToken: string;
  readonly logger?: boolean;

  readonly clock?: () => Date;
};

export const systemClock = (): Date => new Date();
// what the app needs from the outside.

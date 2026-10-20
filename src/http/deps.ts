import type pg from "pg";

export type AppDeps = {
  readonly pool: pg.Pool;
  readonly adminToken: string;
  readonly logger?: boolean;
  readonly clock?: () => Date;
  readonly accountConcurrency?: number;
};

export const systemClock = (): Date => new Date();
// what the app needs from the outside.

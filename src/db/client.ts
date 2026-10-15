
import pg from "pg";
import type { QueryResult, QueryResultRow } from "pg";


pg.types.setTypeParser(
  pg.types.builtins.INT8,
  (value: string) => Number(value),
);

// Anything that can execute a database query.
export type Queryable = {
  query<R extends QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

// reusable database connections.
export const createPool = (
  connectionString: string,
  config: Omit<pg.PoolConfig, "connectionString"> = {},
): pg.Pool => {
  return new pg.Pool({
    connectionString,
    max: 10,
    ...config,
  });
};

// Run database operations in one transaction.
export const withTransaction = async <T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await work(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};


export const exactlyOne = <T>(
  rows: readonly T[],
  description: string,
): T => {
  const row = rows[0];

  if (row === undefined) {
    throw new Error(
      `Expected a row for ${description} but the query returned none`,
    );
  }

  return row;
};

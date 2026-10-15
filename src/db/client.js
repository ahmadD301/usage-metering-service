import pg from "pg";
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
// reusable database connections.
export const createPool = (connectionString, config = {}) => {
    return new pg.Pool({
        connectionString,
        max: 10,
        ...config,
    });
};
// Run database operations in one transaction.
export const withTransaction = async (pool, work) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
};
export const exactlyOne = (rows, description) => {
    const row = rows[0];
    if (row === undefined) {
        throw new Error(`Expected a row for ${description} but the query returned none`);
    }
    return row;
};

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
/** Arbitrary constant: every runner asks for the same lock, so only one migrates at a time. */
const MIGRATION_LOCK_KEY = 727_001;
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const parseFileName = (file) => {
    const match = FILE_PATTERN.exec(file);
    const version = match?.[1];
    const name = match?.[2];
    return version === undefined || name === undefined ? null : { version, name };
};
/** Reads migration files from `dir`, sorted by version. Files that do not match are ignored. */
export const loadMigrations = async (dir) => {
    const entries = await readdir(dir);
    const found = entries
        .map((file) => ({ file, meta: parseFileName(file) }))
        .filter((entry) => entry.meta !== null)
        .slice()
        .sort((a, b) => a.meta.version.localeCompare(b.meta.version));
    const versions = found.map((entry) => entry.meta.version);
    if (new Set(versions).size !== versions.length) {
        throw new Error(`Duplicate migration version in ${dir}`);
    }
    return Promise.all(found.map(async ({ file, meta }) => {
        const sql = await readFile(path.join(dir, file), "utf8");
        return { ...meta, sql, checksum: sha256(sql) };
    }));
};
const applyOne = async (client, migration) => {
    await client.query("BEGIN");
    try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [migration.version, migration.name, migration.checksum]);
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK");
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${migration.version}_${migration.name} failed: ${reason}`, {
            cause: error,
        });
    }
};
/** Applies all pending migrations. Returns the versions applied in this run (empty if none). */
export const runMigrations = async (pool, dir) => {
    const migrations = await loadMigrations(dir);
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
        await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
        const appliedRows = await client.query("SELECT version, checksum FROM schema_migrations");
        const appliedChecksums = new Map(appliedRows.rows.map((row) => [row.version, row.checksum]));
        const newlyApplied = [];
        for (const migration of migrations) {
            const existing = appliedChecksums.get(migration.version);
            if (existing === undefined) {
                await applyOne(client, migration);
                newlyApplied.push(migration.version);
            }
            else if (existing !== migration.checksum) {
                throw new Error(`Migration ${migration.version}_${migration.name} was already applied but its checksum ` +
                    `changed. Never edit an applied migration; add a new one instead.`);
            }
        }
        return newlyApplied;
    }
    finally {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
        client.release();
    }
};

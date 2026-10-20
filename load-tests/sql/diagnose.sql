-- Run with: docker compose exec -T postgres psql -U metering -d metering -f - < load-tests/sql/diagnose.sql
-- Needs the perf overlay (pg_stat_statements). Section 1 is most useful DURING a load test.

\echo '=== 1. What are sessions waiting on right now? (run while a test is running) ==='
SELECT state,
       COALESCE(wait_event_type, '-') AS wait_type,
       COALESCE(wait_event, '-') AS wait_event,
       count(*) AS sessions
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
GROUP BY 1, 2, 3
ORDER BY sessions DESC;

\echo '=== 2. Heaviest statements by total time ==='
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT calls,
       round(total_exec_time::numeric, 0) AS total_ms,
       round(mean_exec_time::numeric, 3) AS mean_ms,
       round(max_exec_time::numeric, 1) AS max_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 80) AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT 12;

\echo '=== 3. Table sizes and dead rows ==='
SELECT relname AS "table",
       n_live_tup AS live_rows,
       n_dead_tup AS dead_rows,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

\echo '=== 4. Does the history query use its index? (latest load account) ==='
SELECT id AS acct FROM accounts WHERE name LIKE 'load-%' ORDER BY created_at DESC LIMIT 1 \gset
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.decision, r.created_at
FROM requests r
JOIN users u ON u.id = r.user_id
WHERE r.account_id = :'acct'
ORDER BY r.created_at DESC, r.id DESC
LIMIT 51;
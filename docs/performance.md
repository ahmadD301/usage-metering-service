# Performance testing

## Environment

- Machine: ___ (CPU, RAM), WSL2 + Docker Desktop. k6, the service and Postgres share this machine, so
  the numbers show relative change only, not production capacity.
- Postgres 16 (Docker), pool of ___ connections, k6 1.0.0 (Docker).
- Each result is the median of ___ runs of 30 s (closed model: a fixed number of virtual users).

## How to reproduce

```bash
cp .env.example .env     # set POSTGRES_PORT if 5432 is taken
bash scripts/load.sh <scenario> <label>
```

Scenarios: `many-accounts`, `hot-account`, `retry-storm`, `tight-limit`, `noisy-neighbor`.
Knobs: `VUS DURATION USERS ACCOUNTS DUPES HOT_VUS QUIET_RATE ACCOUNT_CONCURRENCY DB_POOL_MAX`.
Dependencies: Docker Desktop, Node 22 (for the consistency verifier, `npx tsx`). Results land in
`load-tests/results/`.

Every run ends with `load-tests/verify.ts`, which checks, for every account created by the run,
that the account counter, the sum of the user counters and the sum of accepted requests are equal
and that nothing exceeds the allowance. `tight-limit` also requires the allowance to be used exactly.

## Scenarios

| Scenario | What it tests |
|---|---|
| many-accounts | Throughput when requests spread over many independent accounts |
| hot-account | Worst case: every request contends for one account's lock |
| retry-storm | Concurrent duplicates of one request id are counted once |
| tight-limit | Demand far above a small allowance: no overspending, no under-use |
| noisy-neighbor | Does a hot account slow down quiet accounts? |

## Results

| Step | hot-account req/s | hot p95 (ms) | many-accounts req/s | noisy-neighbor quiet p95 (ms) |
|---|---|---|---|---|
| Baseline (tag `perf-baseline`) | ___ | ___ | ___ | ___ |
| A: merged statements | ___ | ___ | ___ | ___ |
| B: limiter, `ACCOUNT_CONCURRENCY` = ___ | ___ | ___ | ___ | ___ |

Quiet accounts alone (reference): p95 ___ ms.

### Limiter and pool experiments

| Setting | hot-account req/s | quiet p95 (ms) |
|---|---|---|
| ACCOUNT_CONCURRENCY=1 | ___ | ___ |
| ACCOUNT_CONCURRENCY=2 | ___ | ___ |
| ACCOUNT_CONCURRENCY=4 | ___ | ___ |
| ACCOUNT_CONCURRENCY=1000 (off) | ___ | ___ |
| DB_POOL_MAX=10 / 20 / 30 | ___ | ___ |

## Where the time goes

(Fill in from the wait-event samples and `pg_stat_statements`: what dominated, `Lock`, `WALSync`
or `Client`, and what that implies.)

## What I changed, and why

1. **Fewer round trips while the account lock is held.** The lock was held across 8 statements and
   the commit. Reads are now one statement and writes are one statement (data-modifying CTEs), so
   the lock covers 3 statements and the commit. The lock statement stays separate on purpose: in
   `READ COMMITTED` a statement sees a snapshot from the moment it starts, so reads that must see
   the previous holder's commit have to start after the lock is acquired.
2. **Lock first.** The counter row normally exists, so the lock is one statement. Only the first
   request of a month creates the row.
3. **One pre-transaction query** instead of two.
4. **Per-account limiter.** Requests waiting for a busy account wait in memory instead of holding
   pooled connections. It is an optimization only: the database lock remains the correctness
   mechanism, so the service stays correct with several instances.

## Rejected alternatives

- Reading plans before the lock: a plan update could commit in between, so a decision could use a
  stale plan.
- A SQL function that does the whole decision: one round trip, but it duplicates the rules in SQL
  and gives up the pure, tested engine.
- `synchronous_commit=off`: faster, but a crash can lose recent committed decisions. Used only as
  a diagnostic to measure commit flush cost.
- Dropping the lock in favour of conditional updates: the shared allowance spans two counters
  (account and user) and several rules, so one row lock per account is the simplest correct design.

## What I learned

(Fill in: the real bottleneck, what surprised you, what you would do next.)

## Known limitations

- One service instance was tested. With several instances the database lock keeps results correct,
  but the in-memory limiter is per process.
- A single account is limited by its lock hold time. Throughput for one account has a ceiling;
  different accounts scale independently.
- Rejected requests are recorded too (history), so they cost a write.
- Numbers come from a shared laptop environment and show relative changes.
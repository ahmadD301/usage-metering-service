# Usage Metering Service

A backend service that other applications call to track usage and decide whether their users may
perform an action. An **account** (the calling application) has a shared monthly allowance and each
of its **users** has an individual one. Before doing work, the application's backend asks this
service to consume units for a user. The service checks both plans, records the decision, and counts
the usage only if the request is accepted.

- Stack: TypeScript (strict), Fastify, PostgreSQL (raw SQL), Docker Compose.
- One resource is metered throughout: **units** (for example, document pages).
- Includes an example application (web page and CLI) that shows the service in action.

## Quick start

Prerequisites: Docker with Compose v2. Node 22 only if you want to run tests or the CLI demo.

```bash
cp .env.example .env
docker compose up --build
```

| What | URL |
|---|---|
| Example application (open this first) | http://localhost:8080 |
| Metering service API | http://localhost:3000 |

Open the example application and click **Run guided scenario**. It creates a fresh demo account and
walks through eight steps, showing each decision and the remaining allowances (see
[Example client](#example-client)). Database setup, migrations and the predefined plans happen
automatically at service start.

If port 5432 is already taken on your machine (for example by a local PostgreSQL), set
`POSTGRES_PORT=5433` in `.env`. Inside Compose the database always uses 5432.

Smoke test the running stack: `bash scripts/smoke.sh`.

Stop with `docker compose down`. Add `-v` to also delete the database volume.

## How it works

```
 your backend ── X-API-Key ──> POST /consume { userId, requestId, units }
                                   │
   1. authenticate the key -> account (reject if missing or invalid)
   2. validate the input; the user must belong to that account (else 404)
   3. same requestId already decided? -> replay the stored decision (no new counting)
   4. BEGIN; lock the account's monthly counter row
        read both plans, all four counters (account and user, month and day)
        decide with the pure rules engine
        record the request (accepted or rejected) and, if accepted, add the units
      COMMIT
   5. answer { accepted, reason?, remaining, plans, replayed, ... }
```

A rejection consumes nothing but is recorded in history. An accepted request adds the same units to
the user's usage and to the account's shared usage.

## Accounts, users and plans

| Concept | Meaning |
|---|---|
| Account | A calling application. Has an account plan (limits shared by all its users) and an API key. |
| User | A user of that application, registered under one account. Has a user plan (individual limits). |
| Plan | A named set of rules. Scope is `account` or `user`. Predefined plans are read-only and shared by everyone. Custom plans belong to one account and can be edited. |

The account plan and the user plan always apply **together**. Giving a user a larger allowance does not
increase the account's shared allowance.

### Predefined plans (created automatically at startup)

| Plan | Scope | Monthly allowance | Max per request |
|---|---|---|---|
| Starter | account | 10,000 | 100 |
| Pro | account | 100,000 | 1,000 |
| Basic | user | 1,000 | 20 |
| Premium | user | 10,000 | 200 |

New accounts get Starter and new users get Basic unless a plan is given.

### Custom plans

An account can create, view and update its own plans, then assign them to itself (account scope) or to
users (user scope). Several users may share one plan; each keeps separate usage. Updating a plan takes
effect for every account or user using it.

## API keys

1. Create an account with the provisioning secret (`ADMIN_TOKEN`, see [Configuration](#configuration)):

```bash
   curl -s -X POST localhost:3000/accounts \
     -H "X-Admin-Token: dev-admin-token-change-me" -H "Content-Type: application/json" \
     -d '{"name":"Acme"}'
```

   The response contains `"apiKey": "mk_1a2b3c4d_..."`. **It is shown once and never stored.** Only its
   SHA-256 hash is saved.

2. Send the key on every other request in the `X-API-Key` header. The key identifies the calling account
   and grants access only to that account's data. A missing or invalid key returns `401`. Users, plans and
   usage of other accounts are never visible: they answer `404`, exactly like something that does not exist.

## API reference

Every error has one shape: `{ "error": { "code": "...", "message": "...", "details": ... } }`.

### Endpoints

| Method and path | Purpose | Success | Errors |
|---|---|---|---|
| `GET /health`, `GET /ready` | liveness, database readiness (no key) | 200 | 503 |
| `POST /accounts` (`X-Admin-Token`) | create account, returns API key once | 201 | 400, 401, 404, 422 |
| `GET /account` | the account and its plan | 200 | 401 |
| `PUT /account/plan` | assign an account plan `{ planId }` | 200 | 404, 422 |
| `POST /users` | register a user `{ externalId, planId? }` | 201 | 404, 409, 422 |
| `GET /users?limit=&after=` | list users (cursor pagination) | 200 | 400 |
| `GET /users/:externalId` | a user and plan | 200 | 404 |
| `PUT /users/:externalId/plan` | switch a user's plan `{ planId }` | 200 | 404, 422 |
| `GET /users/:externalId/effective-plans` | the account plan and user plan that apply together | 200 | 404 |
| `GET /plans?scope=`, `GET /plans/:planId` | predefined plans plus your custom plans | 200 | 404 |
| `POST /plans` | create a custom plan `{ name, scope, rules }` | 201 | 400, 409 |
| `PUT /plans/:planId` | replace a custom plan's name and rules | 200 | 403, 404, 409 |
| `POST /consume` | consume units `{ userId, requestId, units }` | 200 | 400, 404, 409 |
| `GET /usage?month=YYYY-MM` | account consumed and remaining | 200 | 400 |
| `GET /users/:externalId/usage?month=YYYY-MM` | user and account consumed and remaining | 200 | 404 |
| `GET /history?month=&userId=&outcome=&limit=&cursor=` | request outcomes, newest first | 200 | 400 |

In `/consume`, `userId` is the same identifier you registered as `externalId`.

Error codes: `validation_error` and `bad_request` (400), `missing_api_key`, `invalid_api_key` and
`admin_unauthorized` (401), `plan_read_only` (403), `user_not_found`, `plan_not_found` and `not_found`
(404), `user_already_exists`, `plan_name_taken` and `idempotency_conflict` (409), `plan_scope_mismatch`
(422), `not_ready` (503), `internal_error` (500).

### Examples

```bash
KEY=mk_...   # from POST /accounts

# register a user (Basic plan by default)
curl -s -X POST localhost:3000/users -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"externalId":"alice"}'

# create a custom user plan and assign it
curl -s -X POST localhost:3000/plans -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Interns","scope":"user","rules":[{"kind":"monthly_allowance","limit":100},{"kind":"max_per_request","limit":5}]}'
curl -s -X PUT localhost:3000/users/alice/plan -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"planId":"<plan id from the previous response>"}'

# consume
curl -s -X POST localhost:3000/consume -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"userId":"alice","requestId":"order-1001","units":10}'

# inspect
curl -s localhost:3000/users/alice/effective-plans -H "X-API-Key: $KEY"
curl -s localhost:3000/users/alice/usage -H "X-API-Key: $KEY"
curl -s "localhost:3000/history?limit=5&outcome=rejected" -H "X-API-Key: $KEY"
```

An accepted response (HTTP 200):

```json
{
  "requestId": "order-1001", "userId": "alice", "units": 10,
  "accepted": true, "reason": null, "replayed": false,
  "plans": { "account": { "id": "...", "name": "Starter" }, "user": { "id": "...", "name": "Basic" } },
  "remaining": {
    "account": { "monthlyAllowance": 9990, "dailyAllowance": null, "maxPerRequest": 100 },
    "user": { "monthlyAllowance": 990, "dailyAllowance": null, "maxPerRequest": 20 }
  },
  "decidedAt": "2026-10-16T10:00:00.000Z"
}
```

A rejection is also HTTP 200 with `"accepted": false`. `reason.primary` names the rule that blocked the
request and `reason.violations` lists every rule that did:

```json
{
  "accepted": false,
  "reason": {
    "primary": { "level": "user", "rule": "max_per_request", "limit": 20, "used": null, "remaining": 20, "requested": 25 },
    "violations": [ { "level": "user", "rule": "max_per_request", "limit": 20, "used": null, "remaining": 20, "requested": 25 } ]
  }
}
```

`remaining` is the allowance left after the decision. A rejection leaves it unchanged. `null` means the plan
has no rule of that kind.

## Rules

Both plans must allow the request, and the full amount must fit. Three rule kinds exist at both levels:

| Rule | Meaning |
|---|---|
| `monthly_allowance` | Total units in a UTC calendar month |
| `max_per_request` | Largest amount in one request |
| `daily_allowance` | Total units in a UTC day (the extra rule, see below) |

A plan may have any subset (at most one rule per kind); a missing rule means no limit.

Each rule is a pure function. The engine (`src/domain/evaluate.ts`) runs the rules of the account plan and the user
plan, collects every violation, and orders them: per-request first, then daily, then monthly, and the account before the user
within the same kind. The first one is `reason.primary`.

Examples with an account plan of 10,000/month and 100/request, and a user plan of 1,000/month and 20/request:

- 25 units: rejected by the **user's** per-request limit, even though both allowances have room.
- 10 units: accepted; adds 10 to the user's usage and 10 to the account's shared usage.
- 10 units when the account has only 5 left: rejected by the **account's** monthly allowance, even if the user has plenty.

### The extra rule: daily allowance

`daily_allowance` caps units per UTC day, at either level. It composes with the others in the same way: all
rules of both plans must pass. It is useful for smoothing usage inside a month: a user with 1,000 per
month and 30 per day cannot use the month's allowance in one go. Each new UTC day starts at zero.
It is demonstrated in `tests/http/consume.test.ts` ("enforces a daily allowance").

## Plan changes

- A change applies to requests that read the plan after the update commits. A request already deciding finishes under the plan it read.
- Updating a custom plan replaces its name and rules atomically (one transaction, plan row locked), so
  nobody ever sees half a plan. Everyone using that plan is affected.
- Switching a user's or the account's plan **keeps consumed units**. Usage is stored per owner and period, not per plan,
  so a switch never grants a fresh allowance.
- If an allowance is lowered below existing usage, remaining shows `0` and further requests are rejected at that level
  until the allowance exceeds usage again.
- Request history is never rewritten. Each entry keeps the decision, the plans, and the limits as they were at the time.
- Predefined plans cannot be changed (HTTP 403, and a database trigger enforces it too).

## Retries and idempotency

`requestId` is the idempotency key. Choose it per logical action (a UUID is fine) and **reuse it when retrying**.

| Situation | Result |
|---|---|
| First time a `requestId` is seen | Decided and recorded; `replayed: false` |
| Same `requestId`, same user and units | The stored decision is returned again, `replayed: true`, nothing is counted twice |
| Same `requestId`, different user or units | `409 idempotency_conflict`, nothing changes |
| Many identical requests at once | Exactly one is decided; the others replay it |

- A retry replays the **original decision, even a rejection, even if the plan changed since**. To be evaluated again under a new
  plan, send a new `requestId`.
- Request ids are scoped per account and kept as long as the history.
- A replay carries the same data as the original response (JSON key order may differ).
- The example client retries only transient failures (network errors, timeouts, 429, 5xx), with exponential backoff and jitter, always with the
  same `requestId`. It does not retry 4xx. It does not retry creating users or plans, because repeating a create after a lost response
  would answer 409.

## Example client

`client/` is a small typed application that calls the service with an account's API key, on behalf of its users. The document
processing is simulated (one unit per page). Its code never changes when plans change: only API calls do.

- Web page at http://localhost:8080 and the CLI (`npm run demo` with `METERING_URL` and `ADMIN_TOKEN` set).
- The guided scenario uses a fresh account with a 100 unit monthly allowance and a 50 per request limit:

  1. alice (Basic) processes 10 pages: accepted
  2. alice processes 25 pages: rejected by the **user** per-request limit
  3. alice is switched to Premium (an API call, no client code change)
  4. alice processes 25 pages again: accepted
  5. bob (Premium) processes 40 pages: accepted
  6. bob processes 30 pages: rejected by the shared **account** allowance, although bob has plenty left
  7. step 1 is retried with the same request id: replayed, not counted again
  8. usage is read: the account used 75

- The demo creates its account with the `ADMIN_TOKEN` so it can start from scratch. A real application would just be given its API key.
- The browser never sees the API key: the demo server calls the service on its behalf.

## Product assumptions

Where the brief left behavior open, these choices were made and applied consistently.

| # | Topic | Decision |
|---|---|---|
| A1 | Account creation | `POST /accounts` needs the `ADMIN_TOKEN` provisioning secret (no roles; out of scope) |
| A2 | API keys | `mk_<8 hex>_<43 chars>`, 256 bits random, only the SHA-256 hash is stored, shown once. No rotation endpoint |
| A3 | User identity | The caller's own `externalId`, unique per account; internal ids never leave the service |
| A4 | Unknown or foreign user | `404 user_not_found`, identical for both, so nothing leaks across accounts |
| A5 | Request id | Chosen by the caller, unique per account |
| A6 | Retry | Same payload replays the original stored decision, including rejections |
| A7 | Same id, different payload | `409 idempotency_conflict` |
| A8 | Rejection status | HTTP 200 with `accepted: false`; 4xx and 5xx are reserved for errors |
| A9 | Several violations | All listed; `primary` is chosen by a fixed order (per-request, daily, monthly; account before user) |
| A10 | Number limits | Units: whole numbers from 1 to 1,000,000,000. Limits: whole numbers from 0 to 10^12 |
| A11 | Missing rule | No limit. A plan can have any subset of rules |
| A12 | Defaults | Starter for new accounts, Basic for new users |
| A13 | Month and day | UTC. One timestamp per request decides the period. The month is stored on the request row |
| A14 | Allowance below usage | Remaining shows 0; requests are rejected at that level until the allowance exceeds usage |
| A15 | Plan switch or edit | Applies to requests that read the plan afterwards; usage is kept |
| A16 | Deletion | Not supported for accounts, users or plans (preserves history) |
| A17 | Editing a plan in use | Allowed for custom plans; predefined plans are never editable |
| A18 | Plan scope | Each plan is `account` or `user`; assigning the wrong scope is `422`. Plan names are unique per account |
| A19 | Extra rule | `daily_allowance` at both levels |
| A20 | Retention | All request history and counters are kept forever |
| A21 | Pagination | Keyset (cursor): history by time, users by `externalId` |
| A22 | Errors | One JSON shape everywhere |
| A23 | Zero or negative units | `400 validation_error` |
| A24 | Account usage | A counter row per account and period, updated in the same transaction as the user's counters; tests check it equals the sum of its users' counters |

## Design decisions

- **Functional core, imperative shell.** The decision logic (`src/domain`) is pure: plan, usage and request in, decision out, no I/O, no
  clock. A lint rule forbids database, framework, clock and class use in that folder. Database and HTTP code form the shell around it.
- **One lock per account.** The account's monthly counter row is locked for the duration of a consume transaction. The shared allowance
  needs serialization anyway, only one lock is ever taken (so no deadlocks), and different accounts never contend.
- **Reads that must see the lock holder's commit start after the lock.** In `READ COMMITTED` a statement sees a snapshot from the moment it starts,
  so the lock is its own statement and the decision reads (plans and counters) come in the next one.
- **The database enforces what it can.** Composite foreign keys keep plan scope and account ownership correct, CHECK constraints reject
  negative usage, triggers keep predefined plans read-only, and a unique `(account_id, request_id)` is the idempotency guard.
- **Usage is keyed by owner and period, never by plan.** Switching plans cannot reset usage, and past months stay queryable.
- **Decisions are stored, not recomputed.** Retries replay them and history shows exactly what was decided and why.
- **Errors are values inside the code.** `Result` types for expected failures; exceptions only for unexpected ones, turned into a `500` at one place.
- **Validation at the boundary.** zod schemas parse every body, query and parameter once; code past that point uses typed values.
- **Migrations are numbered SQL files** applied in transactions with a checksum guard and an advisory lock. Applied migrations are never edited.

## Testing

```bash
docker compose up -d postgres              # needs a reachable PostgreSQL
export TEST_DATABASE_URL="postgres://metering:metering_dev_password@localhost:5432/metering"
npm install
npm run format:check && npm run lint && npm run typecheck && npm test
```

Use your own port in the URL if you changed `POSTGRES_PORT`. Each test file runs in its own PostgreSQL schema, so files run in parallel without touching
each other.

What is covered:

| Area | Where |
|---|---|
| Rules engine: the brief's examples, ordering, boundaries, properties (determinism, monotonic, accepted iff headroom) | `src/domain/*.test.ts` |
| API key validation, admin protection, key stored only as a hash | `tests/http/auth.test.ts`, `accounts.test.ts` |
| Account isolation (users, plans, usage, history, consume) | `tests/http/isolation.test.ts`, `consume.test.ts` |
| Both plans enforced, daily rule, month and day rollover | `tests/http/consume.test.ts` |
| Retries and conflicts, including 25 identical concurrent requests counted once | `tests/http/consume.test.ts`, `consume-concurrency.test.ts` |
| Concurrency: no overspend of shared or user allowance, totals agree | `tests/http/consume-concurrency.test.ts` |
| Plan changes: raise, switch, lower below usage, history preserved | `tests/http/consume.test.ts` |
| Schema constraints, migrations, seed idempotency | `tests/db/*.test.ts` |
| Client retries, timeouts, typed errors, plus the whole scenario against the real service | `tests/client/*.test.ts`, `tests/e2e/demo.test.ts` |

## Performance

Load tests use k6 (in Docker) against the Compose stack and finish with a consistency check of the database
(account counter, sum of user counters and sum of accepted requests must agree and never exceed the allowance).

```bash
bash scripts/load.sh <scenario> <label>
# scenarios: many-accounts, hot-account, retry-storm, tight-limit, noisy-neighbor
```

Method, results, bottleneck analysis and what changed are in [docs/performance.md](docs/performance.md).

## Configuration

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | service | (required) | PostgreSQL connection string |
| `ADMIN_TOKEN` | service, demo client | compose: `dev-admin-token-change-me` | Secret for creating accounts (16+ characters). Change it outside local use |
| `PORT`, `HOST` | service, client | 3000 / 8080, 0.0.0.0 | Listen address |
| `MIGRATIONS_DIR` | service | `./migrations` | Folder of SQL migrations |
| `DB_POOL_MAX` | service | 10 | Maximum database connections |
| `ACCOUNT_CONCURRENCY` | service | 2 | Maximum in-flight consume calls per account in one process |
| `METERING_URL`, `REQUEST_TIMEOUT_MS`, `MAX_RETRIES` | client | service url, 5000, 3 | Example client settings |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `SERVICE_PORT`, `CLIENT_PORT` | compose | see `.env.example` | Compose settings |

## Project layout

```
src/domain     pure rules engine (types, rules, evaluate, periods, units)
src/consume    consume flow (pure decision builders + the transactional shell + per-account limiter)
src/db         migrations runner, seed, repositories (raw SQL)
src/http       Fastify app, auth hooks, routes, error format
client/        example application: typed HTTP client, scenario, web page, CLI
migrations/    numbered SQL migrations
tests/         API, database, client and end-to-end tests
load-tests/    k6 scenarios, consistency verifier, diagnostics
scripts/       smoke test and load test runner
```

## Known limitations

- **No key rotation or revocation endpoint** (a key can be revoked only in the database), and **a single shared provisioning secret**
  instead of roles.
- **No deletion or deactivation** of accounts, users or plans.
- **No rate limiting, request quotas on the API itself, or backpressure.** Waiting requests queue in memory.
- **The per-account limiter is per process.** With several instances correctness still comes from the database lock, but
  the limiter only helps within one instance. Multi-instance behavior was not load tested.
- **A busy account has a throughput ceiling** (its lock hold time); different accounts scale independently.
- **History, counters and idempotency records are kept forever.** Daily counters add a row per owner per day. No archiving.
- **Rejected requests are recorded too**, so they cost a write.
- **UTC only**; no per-account time zones. One resource only.
- **The demo application** shares one demo account across browser tabs, keeps it in memory, and has no login.
- **Load test numbers** come from one machine (WSL2 and Docker Desktop, with k6, the service and PostgreSQL sharing it) and show relative changes
  only, not production capacity.
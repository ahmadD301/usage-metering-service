# Usage Metering Service: Analysis, Skill Map, and Plan

Status: **awaiting your approval. No code written yet.**

---

## Step 1: Analysis

### 1.1 The system in my own words

**Actors**

| Actor | Role |
|---|---|
| Account | A customer application/company. Has an API key and an *account plan* (shared limits for all its users). |
| User | An end user registered under one account. Has a *user plan* (individual limits). |
| Plan | A named set of rules. Account-scoped or user-scoped. Predefined (read-only, global) or custom (owned by one account, editable). |
| Calling backend | The account's server. Authenticates with the API key and asks "can user U consume N units?" |
| Metering service | Decides, records, and counts. It is the single source of truth for usage. |

**What a consume request does**

```
POST consume { userId, units, requestId }  + X-API-Key
  1. Authenticate key -> account (reject if missing/invalid)
  2. Validate input; confirm user belongs to that account (else 404)
  3. Idempotency: have we seen (account, requestId)? -> replay stored decision
  4. BEGIN transaction
       lock the account + user usage counters for the current UTC month
       load the effective account plan and user plan
       run the PURE rules engine: (plans, usage, request, now) -> Decision
       insert the request record (accepted or rejected)
       if accepted: add units to user usage AND account usage
     COMMIT
  5. Return the decision + remaining allowances
```

A rejection consumes nothing but is still recorded in history. An acceptance counts the same units once at the user level and once at the account level.

### 1.2 Requirements

**Explicit requirements**

1. Create accounts and issue one API key each; register users under accounts; assign/change user plans; keep accounts' data isolated.
2. Predefined plans (account + user) created at startup; documented limits.
3. Custom plans: create/view/update by the owning account; assign to the account or its users; many users may share a plan but keep separate usage; predefined plans may be read-only.
4. Consume: API key + user id + positive whole units + request id. All-or-nothing; a rejection consumes nothing.
5. Explain decisions: accepted or rejected; on rejection, which rule and which level (account or user). Inspect the plans/limits currently applied.
6. Usage: consumed and remaining at account and user level; previous months queryable; request history with simple pagination.
7. Persistence in PostgreSQL across restarts.
8. Two rule types at both levels: monthly allowance (UTC month) and max units per request. Both plans must pass.
9. Month rollover to zero; past months retained.
10. Plan changes affect only new requests; switching plans keeps consumed units; lowering an allowance below usage shows 0 remaining and blocks until allowance is available; history preserved.
11. At least one additional rule, explained and demonstrated, interacting sensibly with the two plans.
12. Example client (web page or CLI) calling the service with an API key, demonstrating: accepted, user-limit rejection, account-limit rejection, plan switch with no client code change; shows decision and remaining allowances.
13. `docker compose up --build` starts service, Postgres, client; DB init and predefined plan seeding automatic; setup documented.
14. Performance testing with evidence, explanation of method and lessons, reproducible commands.
15. Deliverables: repo, compose + Dockerfiles, README (API, model, keys, rules, plan changes, retries, assumptions, decisions, limitations), automated tests (incl. API key validation and account isolation), performance artifacts.

**Ambiguous or unspecified behavior** (I propose a default for each in 1.4)

- How accounts get created and who may call that endpoint (no key exists yet).
- What a "request identifier" means: scope, what a retry with the same id returns, what happens when the same id arrives with a different payload.
- HTTP status for a business rejection (200 vs 4xx).
- Which rule to report when several fail at once.
- Whether a user/plan/account can be deleted.
- Default plans on account and user creation.
- Whether `userId` is chosen by the caller or by us.
- Behavior of unlimited rules (null) and of a plan with no rules.
- What "extra rule" to add, and how it composes.
- Whether the retried decision is replayed as originally made or re-evaluated.
- Time source for "current month" and what the history stores.
- Number size limits for units and allowances.

**Hidden risks**

| Risk | Why it matters | Planned mitigation |
|---|---|---|
| Concurrent consumes | Two requests both read "5 remaining" and both succeed, overspending | Decide and update inside one transaction with row locks on the usage counters (not read-then-write in app code) |
| Hot account row | Every user's request touches the same account counter, so throughput serializes there | Keep the locked section tiny; measure it in the load test; document the tradeoff |
| Deadlocks | Two transactions locking account/user rows in different orders | Always lock in the same order (account counter, then user counter) |
| Retries / duplicate delivery | Network timeout then retry could double count | Unique constraint on `(account_id, request_id)`; replay stored decision |
| Same id, different body | A buggy client could reuse an id | Store a payload fingerprint; return 409 on mismatch |
| Plan change mid-request | Plan edited while a consume is evaluating | Plan is read inside the consume transaction; the request linearizes at the counter lock. Documented |
| Month boundary | Request starts 23:59:59.9 UTC, finishes after midnight | Month is fixed once, from one timestamp taken at the start of processing, and stored on the request row |
| Allowance lowered below usage | Negative remaining | `remaining = max(0, allowance - used)`; never store negatives; reject at that level |
| Switching plans | Could accidentally reset usage | Usage keyed by (owner, month), not by plan |
| Account total drift | Account usage != sum of user usage | Update both in the same transaction; add a consistency-check query/test |
| Cross-account leakage | User/plan ids from another account | Every query scoped by `account_id` from the key; return 404 (not 403) for foreign resources |
| API key storage | Leaked DB exposes keys | Store only a SHA-256 hash plus a short prefix; show the key once |
| Integer overflow / bad input | `units` = 1e30, 2.5, "10" | Validate positive safe integer at the boundary; `BIGINT` in SQL |
| Predefined plan mutation | Someone edits Starter and breaks everyone | Predefined plans are global and read-only; enforced in the service and the DB |
| Plan assigned to wrong level | A user plan assigned to an account | Plans have a `scope`; assignment validates it |
| History growth | Large unbounded lists | Keyset pagination with indexes |

### 1.3 What the pure rules engine looks like (preview)

Data in, decision out, no I/O.

```ts
type Level = "account" | "user";
type RuleKind = "monthly_allowance" | "max_per_request" | "daily_allowance";

type Decision =
  | { readonly kind: "accepted"; readonly units: number }
  | { readonly kind: "rejected";
      readonly primary: Violation;
      readonly violations: readonly Violation[] };

type Violation = {
  readonly level: Level;
  readonly rule: RuleKind;
  readonly limit: number;
  readonly used?: number;
  readonly remaining: number;
  readonly requested: number;
};

// A rule is a pure function: (context) => Violation | null
type Rule = (ctx: EvaluationContext) => Violation | null;
```

`evaluate = (rules, ctx) => rules.map(r => r(ctx)).filter(isViolation)` then a fold into the discriminated union.

### 1.4 Proposed product assumptions (please approve or change)

| # | Topic | Proposed default | Reasoning |
|---|---|---|---|
| A1 | Account creation | `POST /accounts` is protected by an `ADMIN_TOKEN` env var (provisioning only); returns the API key once | No key exists yet; roles/permissions are out of scope, so one shared provisioning secret is the simplest safe option. Alternative: leave it open (simpler, less safe) |
| A2 | API key format | `mk_<prefix>_<random>`, 32 random bytes, stored as SHA-256 hash + prefix, shown once; no rotation | Standard practice; rotation is not required |
| A3 | User identity | Caller supplies an `externalId` string, unique per account; we keep an internal UUID. Consume accepts `externalId` | Matches "user identifier"; apps already have their own ids |
| A4 | Unknown / foreign user | 404 `user_not_found`, same response for both cases | Avoids leaking other accounts' users; meets "validate user belongs to account" |
| A5 | Request id scope | Unique per account. Client chooses it (UUID recommended) | Different accounts must not collide or probe each other |
| A6 | Retry behavior | Same `(account, requestId)` and same payload replays the **original** stored decision (accepted or rejected) with a `replayed: true` flag and the same status. Not re-evaluated, even if plans changed since | Retries must be safe and predictable; a rejection followed by a plan upgrade must not silently turn into an acceptance under the same id (client should use a new id) |
| A7 | Same id, different payload | 409 `idempotency_conflict` | Detects client bugs without changing counts |
| A8 | HTTP status for rejection | `200` with `accepted: false` and the explanation (not 4xx) | A rule rejection is a valid business outcome, not a client error; clients branch on one field. 4xx/5xx are reserved for malformed/unauthorized/failed requests |
| A9 | Multiple failing rules | Return all violations, plus a deterministic `primary`: per-request limits before monthly allowances, account before user within the same type | The brief only needs "a rule"; a stable order makes tests and client behavior predictable |
| A10 | Unit and allowance size | Units: positive integer up to 1,000,000,000 per request. Allowances: integers from 0 up to 10^12. Stored as `BIGINT` | Avoids JS float/overflow issues |
| A11 | Unlimited rules | A rule that is absent means "no limit". A plan may have any subset of rules | Simplest, composable representation |
| A12 | Default plans | New accounts get **Starter**, new users get **Basic**, unless a plan is specified | Always a working default |
| A13 | Month | UTC calendar month, computed from one `now()` per request via an injectable clock; stored as `period_start` (first day) on counters and on the request row | Testable rollover; no ambiguity at the boundary |
| A14 | Allowance reduced below usage | `remaining = 0`, rejections until allowance exceeds usage again | Per brief |
| A15 | Plan switch/edit | Takes effect for requests that begin their transaction after commit; usage unchanged | Per brief |
| A16 | Deletion | No delete for accounts, users, or plans in scope. Users can be **deactivated** (consume returns 403 `user_inactive`) only if you want it; default: not implemented | "Preserve history" argues against deletes; avoid scope creep |
| A17 | Custom plan in use | A custom plan can be edited at any time. A plan assigned to anything cannot be removed (no removal exists anyway) | Follows A16 |
| A18 | Plan scope | Each plan has `scope = account` or `user`; assignment validates scope. Custom plan names unique per account | Prevents misuse |
| A19 | **Extra rule** | **Daily allowance** (UTC day), available at both levels, as a third rule kind alongside the two required ones | Shows rule composition cleanly: same pure shape, same both-levels semantics, needs one extra counter table and demonstrates a real interaction (daily cap tighter than the monthly remainder). **Needs your approval since it adds scope** |
| A20 | History retention | Keep all request rows forever; usage counters per (owner, month) | Simple; documented as a limitation |
| A21 | Pagination | Keyset (cursor) pagination ordered by `(created_at desc, id desc)`, filterable by month, user, outcome | Stable under concurrent inserts; better than OFFSET |
| A22 | Error format | `{ "error": { "code": "...", "message": "...", "details": ... } }` everywhere | Consistent, machine-readable |
| A23 | Zero-unit / negative units | 400 `validation_error` | "Positive whole number" |
| A24 | Account usage | Stored as its own counter row, updated in the same transaction as the user counter; a test asserts it equals the sum of user counters | Fast reads and no recomputation; consistency tested |

### 1.5 Open questions

Nothing truly blocks me. Three decisions I want your explicit say on (defaults in the table above):

1. **A1**: protect `POST /accounts` with an admin token, or leave it open for simplicity?
2. **A19**: approve the "daily allowance" extra rule, or pick a different one (e.g. a per-minute burst limit), or skip it?
3. **Stack details**: Fastify + zod + `pg` (raw SQL, hand-written migrations) + Vitest for tests, and k6 (via Docker) for load tests. OK?

---

## Step 2: Skill Coverage Map

| Skill | Where it appears | Concrete deliverable | How you can verify it |
|---|---|---|---|
| **Git** | Whole project lifecycle | Branch per milestone (`feat/m2-sql-schema`), merged with `--no-ff`; Conventional Commits (`feat:`, `test:`, `docs:`); `.gitignore`; a tag per milestone (`v0.1-engine` ...); no giant commit | `git log --oneline --graph` reads as a story; `git branch -a`, `git tag`; each commit builds and passes tests |
| **Functional programming** | `src/domain/` rules engine and `src/shared/` helpers | Pure `evaluate(rules, ctx)`; each rule a pure function `ctx -> Violation \| null`; combined with `map/filter/reduce`; `readonly` types; `Result<T,E>` instead of throwing in the domain; `pipe` helper; higher-order functions and partial application for building rules from plans; repositories passed as function parameters (dependency injection by closure) | Domain folder imports nothing from `pg`/`fastify`/`fs`/`Date` (enforced by an ESLint `no-restricted-imports` rule); unit tests need no mocks or DB; property-based tests (fast-check) show determinism and "rejection never changes totals" |
| **TypeScript** | Everywhere | `strict: true`, `noUncheckedIndexedAccess`, no `any` (lint-enforced), discriminated unions (`Decision`, `Result`, API error codes), branded types for `AccountId`/`UserId`/`Units`, zod schemas that infer types at the boundaries | `tsc --noEmit` passes; `grep -r "any"` is empty; hovering types in the editor; compile errors when a union case is unhandled (exhaustive `switch` with `never`) |
| **HTTP clients** | `client/` example app | A small typed client module built on `fetch`: base URL, `X-API-Key` header, `AbortSignal.timeout`, status-code handling, safe retries (same `requestId`, exponential backoff with jitter, only on network error/5xx/timeout), zod-parsed responses; a scenario runner and minimal web page | Client unit tests against a fake server (retry on 503 then success; timeout; 409 no retry); run the scenario and see the 4 required demonstrations; kill the service mid-run and watch retries not double count |
| **SQL** | `migrations/`, `src/db/` | Normalized schema (accounts, api_keys, plans, plan_rules, users, usage_counters, daily counters, requests); constraints (CHECKs, FKs, uniques); indexes; numbered migrations; transactions; atomic updates with row locks / conditional updates; monthly usage queries; keyset-paginated history | `\d` in psql; `EXPLAIN` on history/usage queries; concurrency test with 200 parallel consumes proves no overspend; consistency query (account total = sum of users) returns zero mismatches |
| **HTTP servers** | `src/http/` | Routing; auth middleware (key hash lookup, attaches `account`); account-isolation scoping; zod validation; central error handler producing the consistent error format; correct status codes; idempotent consume endpoint; health/readiness endpoints | API tests (supertest-style via Fastify `inject`): 401 missing/invalid key, 404 cross-account, 400 validation, 409 conflict, replay returns the same body |
| **Docker** | Root + `service/` + `client/` | Multi-stage Dockerfiles (build then slim runtime, non-root user); `docker-compose.yml` with Postgres + service + client; health checks and `depends_on: condition: service_healthy`; migrations + seed run at service start; volume for data; env-based config; optional `k6` profile for load tests | `docker compose up --build` from a clean clone; `docker compose ps` shows healthy; open the client URL; `docker compose down && up` keeps data; `docker image ls` shows small images |

---

## Step 3: Milestone Plan (one week)

Conventions: `main` always green. Each milestone = one feature branch, small commits, merge with `--no-ff`, tag. Tests are written alongside the code, in the same commits or the one right before.

### M0: Foundation (Day 1, morning)
- **Branch:** `chore/m0-scaffold`
- **Tasks:** repo init, `.gitignore`, `package.json`, strict `tsconfig`, ESLint (no `any`, import boundaries), Prettier, Vitest, folder layout (`src/domain`, `src/db`, `src/http`, `client/`, `migrations/`, `load-tests/`), a minimal compose file with Postgres + health check.
- **Skills:** Git, TypeScript, Docker.
- **Commits (plan):** `chore: init repo and gitignore` / `chore: strict TypeScript and lint config` / `chore: vitest setup` / `chore: compose with postgres healthcheck`.
- **Proof:** `npm test` runs (even with one trivial test); `docker compose up postgres` becomes healthy.

### M1: Pure rules engine (Day 1 afternoon to Day 2 morning)
- **Branch:** `feat/m1-rules-engine`
- **Tasks:** domain types (branded `Units`, `Plan`, `Rule` config, `Decision` union, `Result`); rule builders from plan config; `evaluate`; month/day period helpers (pure, take a `Date`); remaining-allowance calculator (clamped at 0); violation ordering (A9).
- **Skills:** Functional programming, TypeScript.
- **Commits:** `feat(domain): core types` / `feat(domain): per-request rule` / `feat(domain): monthly allowance rule` / `feat(domain): daily allowance rule` / `feat(domain): evaluate and violation ordering` / `test(domain): brief examples (25, 10, 5 remaining)` / `test(domain): property tests`.
- **Tests that prove it:** the three worked examples from the brief; allowance below usage gives 0 remaining and rejection; both levels must pass; ordering is deterministic; same input gives the same output; rejection result implies zero increments (property test); month boundary periods.

### M2: SQL schema, migrations, seed (Day 2)
- **Branch:** `feat/m2-sql-schema`
- **Tasks:** migration runner (numbered `.sql` files plus `schema_migrations` table, each in a transaction); tables, constraints, indexes; idempotent seed of predefined plans (Starter 10,000/100, Pro 100,000/1,000, Basic 1,000/20, Premium 10,000/200, finalized in README); repository functions (thin, parameterized SQL).
- **Skills:** SQL, Docker (startup init), TypeScript.
- **Commits:** `feat(db): migration runner` / `feat(db): accounts, api_keys, plans, plan_rules` / `feat(db): users and assignments` / `feat(db): usage counters and requests` / `feat(db): idempotent seed` / `test(db): constraints and seed idempotency`.
- **Tests:** migrations apply twice without error; seed twice leaves one copy; CHECK constraints reject negative usage, scope mismatches; unique `(account_id, request_id)`.

### M3: HTTP server, auth, accounts, users, plans (Day 3)
- **Branch:** `feat/m3-http-api`
- **Tasks:** app bootstrap and config; central error handler and error format; auth middleware (hash lookup, constant-time compare); account-scoped routes: create account (admin-token protected, A1), register user, assign/change user plan, assign account plan, plan CRUD for custom plans, read-only predefined plans, "effective plans" inspection endpoint; zod validation; health and readiness.
- **Skills:** HTTP servers, SQL, TypeScript.
- **Commits:** `feat(http): server bootstrap and error format` / `feat(http): api key auth middleware` / `feat(http): accounts and keys` / `feat(http): users` / `feat(http): custom plans CRUD` / `feat(http): plan assignment` / `test(http): auth and isolation`.
- **Tests:** missing/invalid key gives 401; account A cannot read or modify B's users or plans (404); predefined plans cannot be edited; plan scope validation; validation errors give 400 with details; custom plan update is visible on next read.

### M4: Consume, idempotency, usage, history (Days 3 to 4)
- **Branch:** `feat/m4-consume-and-usage`
- **Tasks:** the consume transaction (idempotency insert, lock counters in fixed order, load plans, call pure engine, record, increment); replay logic and conflict detection; usage endpoints (account and per user, per month); history endpoint with keyset pagination and filters; consistency check query.
- **Skills:** SQL (transactions/locking), HTTP servers (idempotent endpoint), Functional programming (imperative shell around the pure core).
- **Commits:** `feat(consume): transaction skeleton with locks` / `feat(consume): idempotency replay and conflict` / `feat(usage): remaining allowances` / `feat(history): keyset pagination` / `test(consume): both-plan enforcement` / `test(consume): concurrency` / `test(consume): plan changes and rollover`.
- **Tests that prove it:**
  - both-plan enforcement (user per-request, user monthly, account monthly, account per-request);
  - rejection consumes nothing, account total equals the sum of users;
  - 200 concurrent requests near the limit: accepted total never exceeds the allowance; exactly the right number accepted;
  - retry returns the identical decision and does not double count; same id with different payload gives 409; concurrent duplicates of one id count once;
  - plan switch keeps usage; lowering allowance below usage gives remaining 0 and rejection; raising it lets requests through again;
  - month rollover using an injected clock; previous month still queryable;
  - history preserved after plan edits.

### M5: HTTP client, example app, full Compose stack (Day 5)
- **Branch:** `feat/m5-client-and-compose`
- **Tasks:** typed client library (`fetch`, timeouts, retries with the same request id, status handling, zod-parsed responses); scenario runner implementing the 4 required demonstrations; minimal web page (served by the client container; API key stays server-side) showing decision and remaining allowances for two users with different plans, plus a "switch plan" button; Dockerfiles; compose with health checks, migration and seed on startup; `.env.example`.
- **Skills:** HTTP clients, Docker, Git.
- **Commits:** `feat(client): typed http client with timeout` / `feat(client): safe retries with idempotency key` / `feat(client): scenario runner` / `feat(client): demo web page` / `build: service and client Dockerfiles` / `build: full compose stack`.
- **Tests:** client unit tests against a stub server (503 then success, timeout, 4xx not retried, malformed body rejected by zod); a scripted smoke test (`scripts/smoke.sh`) run against the composed stack.

### M6: Performance testing and optimization (Day 6)
- **Branch:** `perf/m6-load-testing`
- **Tasks:** k6 scripts (many users under one account = hot account row; many accounts = parallel path; mixed read/write; retry storm with duplicate ids); baseline run; find bottleneck (EXPLAIN, `pg_stat_activity`, lock waits); optimize (e.g. tighten transaction scope, make idempotency insert cheap, connection pool sizing, indexes, single-statement conditional update variant); re-run; verify correctness after each run with the consistency query; record results.
- **Skills:** SQL, Docker, HTTP servers.
- **Commits:** `perf: k6 scenarios and runner script` / `perf: baseline results` / `perf: <specific optimization>` / `perf: post-optimization results` / `docs: load test findings`.
- **Proof:** results table (p50/p95/p99, throughput, error rate) before vs after, commands to reproduce, and a correctness check showing zero overspend after the run.

### M7: Documentation, hardening, final review (Day 7)
- **Branch:** `docs/m7-readme-and-review`
- **Tasks:** README (quickstart, API with curl examples, model, keys, rules and the extra rule, plan changes, retry behavior, all assumptions, design decisions, limitations, how to run tests and load tests); fill gaps found by testing from a clean clone; final review against this coverage table and the brief's deliverables.
- **Skills:** Git, Docker, all.
- **Commits:** `docs: README api and setup` / `docs: assumptions and decisions` / `docs: limitations` / `fix: <anything found on clean clone>`.
- **Proof:** fresh clone, `docker compose up --build`, and the demo works with no manual steps.

### Each milestone ends with
A short **"What I should be able to explain"** checklist (design choice, one trace through the code, one thing that would break if changed).

### Scope guardrails
In scope: only what the brief requires plus the single extra rule (A19, pending your approval). Out of scope unless you ask: billing, refunds, user login, RBAC, key rotation, deletions, multi-resource units, distributed infrastructure.

---

## What I need from you

1. Approve or change assumptions **A1 to A24** (especially A1, A6, A8, A19).
2. Confirm the stack: Fastify + zod + `pg` (raw SQL) + Vitest + k6.
3. Say "go" and I will start with **M0**.

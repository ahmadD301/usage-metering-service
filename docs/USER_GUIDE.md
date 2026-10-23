# Usage Metering Service: User Guide

A practical guide to starting, operating, verifying and troubleshooting the project. You do not need to
read the code. For how the system is designed, see [PROJECT_WALKTHROUGH.md](PROJECT_WALKTHROUGH.md).
For the full API reference see the [README](../README.md#api-reference); for load-test results see
[performance.md](performance.md).

Commands assume a Linux or WSL shell with `bash`, run from the **repository root** unless stated.

## Contents

1. [What the application does](#1-what-the-application-does)
2. [Prerequisites](#2-prerequisites)
3. [Start the application](#3-start-the-application)
4. [Use the browser demo](#4-use-the-browser-demo)
5. [Automated verification commands](#5-automated-verification-commands)
6. [Test the API manually](#6-test-the-api-manually)
7. [Data persistence and cleanup](#7-data-persistence-and-cleanup)
8. [Troubleshooting](#8-troubleshooting)
9. [Final verification checklist](#9-final-verification-checklist)
10. [Verification status](#10-verification-status)

---

## 1. What the application does

An application (for example a document-processing app) needs to control how much its users may use
a resource. This service answers one question for it: **"May this user consume N units right now?"**
Here a unit might be one page of a document.

| Concept | Meaning |
|---|---|
| **Account** | The calling application. It has an API key and an **account plan**: limits shared by all its users. |
| **User** | A person using that application, registered under an account. Each user has a **user plan**: limits for that one person. |
| **Plan** | A named set of limits. Predefined plans (Starter, Pro, Basic, Premium) are built in and read-only. An account can create custom plans. |
| **Monthly allowance** | The total units allowed in a UTC calendar month. |
| **Maximum per request** | The largest amount allowed in one request. |
| **Daily allowance** | An optional extra rule (units per UTC day) available in custom plans. |

Predefined plans:

| Plan | For | Monthly allowance | Max per request |
|---|---|---|---|
| Starter | account | 10,000 | 100 |
| Pro | account | 100,000 | 1,000 |
| Basic | user | 1,000 | 20 |
| Premium | user | 10,000 | 200 |

### What happens when units are requested

The application sends the user, a **request id** and the number of units. The service applies the
account plan **and** the user plan together. The request is accepted only if **every** limit of both
plans allows the full amount. A larger user allowance never increases the account's shared allowance.

- **Accepted:** the units are added to the user's usage and, once, to the account's shared usage.
- **Rejected:** nothing is consumed. The answer names the rule that blocked the request and whether it
  belongs to the **account** or the **user**. A rejection is a normal answer (HTTP 200 with
  `"accepted": false`), not an error.
- **Remaining allowances:** every answer shows what is left under each rule after the decision.
- **Request history:** every decision, accepted or rejected, is stored and can be listed (API only).
- **Retries:** if the same request id is sent again, the service returns the original answer and does
  not count it twice. This makes network retries safe.

Switching a plan changes the limits for future requests. It does **not** erase units already used.

---

## 2. Prerequisites

| Tool | Needed for | Check |
|---|---|---|
| Docker with Compose v2 | running the stack | `docker --version` and `docker compose version` |
| A running Docker daemon | running the stack | `docker info` (should print server details, not an error) |
| Node.js 22 or newer and npm | tests, CLI demo | `node --version` and `npm --version` |
| `curl` | smoke test, manual API checks | `curl --version` |
| `bash` | scripts | `bash --version` |
| A web browser | browser demo | |
| Git (optional) | cloning the repository | `git --version` |

Optional: `jq` for pretty-printed JSON (pipe any `curl` output into `jq .`).

If `docker` is "not found" inside WSL, see [Troubleshooting](#docker-is-not-available-in-wsl).

Install the Node dependencies once (needed for tests, linting and the CLI demo, not for the Docker stack):

```bash
npm install
```

---

## 3. Start the application

### 3.1 Go to the repository root

```bash
cd ~/projects/usage-metering     # or wherever you cloned the repository
```

### 3.2 Create your settings file

```bash
cp .env.example .env
```

`.env` holds the settings Compose reads. The defaults work as they are. Things you may change:

| Setting | Default | When to change it |
|---|---|---|
| `POSTGRES_PORT` | 5432 | If another PostgreSQL already uses 5432 on your machine. Use `5433`. |
| `SERVICE_PORT` | 3000 | If port 3000 is busy. |
| `CLIENT_PORT` | 8080 | If port 8080 is busy. |
| `ADMIN_TOKEN` | `dev-admin-token-change-me` (compose default if unset) | Needed to create accounts. Change it for anything beyond local use. |

If you change a port, use your value in every URL in this guide.

### 3.3 Build and start the complete stack

```bash
docker compose up --build -d
```

`up` creates and starts the containers, `--build` rebuilds the images from the Dockerfiles, and `-d` runs
them in the background. The first build takes a few minutes. The stack has three services:

| Service | What it does | Port on your machine |
|---|---|---|
| `postgres` | the database (PostgreSQL 16) | `POSTGRES_PORT` (5432) |
| `service` | the metering API. On startup it applies the database migrations and creates the predefined plans | `SERVICE_PORT` (3000) |
| `client` | the example application and browser demo | `CLIENT_PORT` (8080) |

Startup order is enforced by health checks: PostgreSQL must be healthy, then the service, then the client.

### 3.4 Confirm everything is healthy

```bash
docker compose ps
```

All three services should show `healthy` in the STATUS column. `health: starting` means wait a few
seconds and run the command again (the service can take up to about a minute on first start).

Check the API directly:

```bash
curl -s http://localhost:3000/health   # {"status":"ok"}
curl -s http://localhost:3000/ready    # {"status":"ready"}
```

`/health` says the process is running. `/ready` also checks that the database answers.

### 3.5 Open the demo

Browse to **http://localhost:8080** (use your `CLIENT_PORT` if you changed it). See
[section 4](#4-use-the-browser-demo).

### 3.6 If startup fails

| Symptom | First command | See |
|---|---|---|
| A service is not `healthy` or keeps restarting | `docker compose logs --tail=100 postgres service client` | [Troubleshooting](#containers-do-not-become-healthy) |
| "port is already allocated" or "address already in use" | `docker compose ps -a` | [Port already in use](#a-port-is-already-in-use) |
| Build error | `docker compose build service` (read the first error) | [Troubleshooting](#build-problems) |

---

## 4. Use the browser demo

The demo is a simulated document-processing application. It charges **one unit per page** through the
metering service. Its processing code never changes when plans change: only the plans do.

### 4.1 What is on the page

The page is titled **Document processing demo**. From top to bottom:

1. Two buttons: **Run guided scenario** and **New demo account**.
2. A **Try it yourself** section:
   - a **user** drop-down (`alice` or `bob`), a **pages** number box (starts at 10) and a
     **Process document** button;
   - a **plan** drop-down (`Basic` or `Premium`) and a **Switch the selected user's plan** button.
3. A status line under those controls (shows results, "Working..." or errors).
4. **Remaining allowances**: a table with columns *Plan*, *Used this month*, *Left this month*, *Max per request*.
   Rows: **Account (shared)**, **alice**, **bob**.
5. **Scenario steps**: the result of the guided scenario.

The page has **no history screen** and does not show the API key. Request history is available through the
API ([section 6](#6-test-the-api-manually)).

### 4.2 The demo account

Both **Run guided scenario** and **New demo account** create a **fresh account**, so results are repeatable.
That account has:

| Who | Plan | Monthly allowance | Max per request |
|---|---|---|---|
| Account (shared) | **Demo account plan** (custom) | 100 | 50 |
| alice | Basic | 1,000 | 20 |
| bob | Premium | 10,000 | 200 |

The account plan matters: Bob's Premium plan allows 200 per request, but the account allows only 50, and
the account has only 100 units for **everyone** together. The *Max per request* column shows the user's
own limit, not the account's.

The demo session lives in memory in the `client` container. If you restart that container the page shows
"No demo account yet. Create one first." The data stays in the database.

### 4.3 Control reference

| Control | Use it when | What happens | Success looks like | Failure looks like |
|---|---|---|---|---|
| **Run guided scenario** | You want the full, repeatable demonstration | Creates a fresh account, then runs 8 steps (see 4.4). All buttons are disabled while it works | The status line says **All steps behaved as expected.**, every step has a green **OK** | A red **X** on a step, and the status line says **Some steps did not match the expectation.** Or `Error: ...` |
| **New demo account** | You want a clean slate to experiment | Creates a fresh account with alice (Basic) and bob (Premium), clears the steps list | **New demo account ready.** and the table shows 0 used for everyone | `Error: ...` (for example the service is not reachable) |
| **user** drop-down | Always | Chooses who the next action applies to (both **Process document** and **Switch**) | | |
| **pages** box | Before **Process document** | Number of pages (units) to charge. Must be a whole number, 1 or more | | |
| **Process document** | You want to see a decision | Sends one request for the selected user. Every click is a **new** request | **ACCEPTED: alice processed 10 page(s). Left this month: alice 990, account 90.** and the table updates | **REJECTED: ... Blocked by the ...**, nothing is consumed. Or `FAILED: ...` / `Error: ...` for technical problems |
| **plan** drop-down | Before **Switch** | Chooses Basic or Premium | | |
| **Switch the selected user's plan** | You want to see how a plan changes what a user can do | Changes the plan of the **selected user** only | **Plan switched. Try processing again.** and the table shows the new plan name | `Error: ...` |

A **REJECTED** result is not a crash. It means the limits did not allow the request. The sentence names the
level (`user` or `account`) and the rule (`per-request limit`, `monthly allowance`), plus the limit, the amount
used (if applicable), the amount left and the amount you asked for.

Before an account exists the table shows "No demo account yet. Create one first.", and **Process document**
or **Switch** show `Error: Create a demo account first`.

### 4.4 The guided scenario, step by step

Click **Run guided scenario**. These steps run in order and each shows its title, the expectation and the result.

| # | Step title | Expected | What you should see (and why) |
|---|---|---|---|
| 1 | alice processes 10 pages | accepted | `ACCEPTED: alice processed 10 page(s). Left this month: alice 990, account 90.` |
| 2 | alice processes 25 pages (her Basic plan allows 20 per request) | rejected by the **user** per-request limit | `REJECTED: alice asked for 25 page(s). Blocked by the user per-request limit (limit 20, 20 left, asked 25).` |
| 3 | Switch alice from Basic to Premium (an API call, no client code change) | plan change succeeds | `alice is now on Premium.` |
| 4 | alice processes 25 pages again (same code as step 2) | accepted now | `ACCEPTED: ... Left this month: alice 9965, account 65.` Same code, same request, different plan. |
| 5 | bob processes 40 pages | accepted | `ACCEPTED: ... Left this month: bob 9960, account 25.` |
| 6 | bob processes 30 pages (the shared account has 25 left) | rejected by the shared **account** allowance, even though bob has plenty | `REJECTED: bob asked for 30 page(s). Blocked by the account monthly allowance (limit 100, used 75, 25 left, asked 30).` |
| 7 | Retry the exact request from step 1 (same request id) | replayed, not counted again | `REPLAYED, not counted again: alice had already processed 10 page(s). ...` It shows the **original** numbers (alice 990, account 90), not today's. |
| 8 | Read the account usage | 75 units used | `The account has used 75 units this month.` (10 + 25 + 40; the replay and both rejections added nothing) |

The table at the end should show: Account (shared), Demo account plan, **75** used, **25** left;
alice, Premium, **35** used, **9965** left; bob, Premium, **40** used, **9960** left.

### 4.5 Plan switching demonstration (Basic to Premium)

Use a clean account so the numbers match.

1. Click **New demo account**. The table shows alice on **Basic**: used 0, left 1000, max per request 20.
2. Choose **alice** in the user drop-down, type **25** in the pages box, click **Process document**.
3. Expected: `REJECTED: alice asked for 25 page(s). Blocked by the user per-request limit (limit 20, 20 left, asked 25).`
   Alice's Basic plan allows 20 per request. The account would have allowed it (50 per request, 100 for the month),
   so the **user** limit is what blocks it. The table still shows alice used **0**: a rejection consumes nothing.
4. Choose **Premium** in the plan drop-down (with alice still selected) and click **Switch the selected user's plan**.
   Expected: `Plan switched. Try processing again.` and alice's plan shows **Premium**, used 0, left 10000, max per request 200.
5. Click **Process document** again with 25 pages.
6. Expected: `ACCEPTED: alice processed 25 page(s). Left this month: alice 9975, account 75.`
   Premium allows 200 per request and the account still allows 25 (it has 100 for everyone, 50 per request).
7. The table now shows alice used **25**, left **9975**, and the account used **25**, left **75**.

### 4.6 Switching a plan is not resetting usage

Continue from 4.5:

1. Choose **Basic** and click **Switch the selected user's plan** for alice.
2. The table shows alice on **Basic** with used **25** (not 0) and left **975** (1000 minus 25). Her 25 used units were kept.
3. Switching back to Premium shows used 25 again.

Changing a plan only changes the **limits** applied to future requests. Usage is stored per user and per month, not
per plan, so a switch can never grant a fresh allowance. This is covered by the automated test
`keeps consumed units when a user switches plans` in `tests/http/consume.test.ts`. A new month (UTC) is the only
thing that starts usage from zero again.

### 4.7 What the demo does not do

It has no history view, no plan editor, no delete, and no login. It does not show the API key. Every **Process
document** click sends a new request id, so the page never shows a replay by itself. The replay is demonstrated by
guided-scenario step 7 and by the curl steps in section 6.

---

## 5. Automated verification commands

### 5.1 Command-line demo (same scenario, no browser)

Where: repository root, with the stack running and `npm install` done.

```bash
METERING_URL=http://localhost:3000 ADMIN_TOKEN=dev-admin-token-change-me npm run demo
```

Use your own port and `ADMIN_TOKEN` if you changed them. It creates a fresh account and prints the same eight steps as
`[ OK ]` or `[FAIL]` lines, then the final usage. The exit code is non-zero if any step did not match its expectation.

### 5.2 Smoke test of the running stack

Where: repository root, stack running.

```bash
bash scripts/smoke.sh
```

What it checks: the client is reachable, the service reports `ready`, and the guided scenario run through the client
reports that every step behaved as expected. Success ends with:

```text
OK: every scenario step behaved as expected.
```

Failure prints `FAILED. Response:` followed by the scenario response and exits with 1. Next step:
`docker compose logs --tail=100 service client`. If you changed ports, run it as
`CLIENT_URL=http://localhost:<client port> SERVICE_URL=http://localhost:<service port> bash scripts/smoke.sh`.
Each run creates a fresh demo account, so a browser tab refreshed afterwards shows that account.

### 5.3 Static checks

Where: repository root. None of these need the stack.

| Command | What it checks | Success looks like | A failure means |
|---|---|---|---|
| `npm run typecheck` | TypeScript types (strict mode) | no output, exit code 0 | a type error: the message gives file and line |
| `npm run lint` | ESLint rules, including the rule that keeps `src/domain` free of database, framework and clock code | no output, exit code 0 | a lint problem (file and rule are shown) |
| `npm run format:check` | Prettier formatting | `All matched files use Prettier code style!` | run `npm run format` to fix |
| `npm run build` | compiles the production JavaScript into `dist/` | no output, exit code 0 | a compile error. If you see `EACCES`, see [Build problems](#build-problems) |

### 5.4 Automated tests

Where: repository root. The tests need a reachable PostgreSQL (each test file uses its own temporary schema and removes it
afterwards; your application data is not touched).

```bash
docker compose up -d postgres
docker compose ps                     # postgres must be healthy
export TEST_DATABASE_URL="postgres://metering:metering_dev_password@localhost:5432/metering"
npm test
```

Use your `POSTGRES_PORT` in the URL (for example `5433`) and your own credentials if you changed them. Without
`TEST_DATABASE_URL` the tests use port 5432 and the default credentials. The export lasts for the current
terminal; add the line to `~/.bashrc` to keep it.

Success looks like:

```text
 Test Files  27 passed (27)
      Tests  199 passed (199)
```

The counts grow when tests are added. What the tests cover: the rules engine, API key validation and account isolation,
both plans being enforced, month and day rollover, retries and conflicts, plan changes, concurrent requests never overspending,
the database schema and migrations, the client's retries, and the full scenario against the real service.

| Failure | Meaning | Next command |
|---|---|---|
| `password authentication failed for user "metering"` | You are reaching a different PostgreSQL, or the volume holds an old password | `ss -ltnp \| grep 5432` then see [Troubleshooting](#password-authentication-failed-for-user-metering) |
| `ECONNREFUSED 127.0.0.1:<port>` | Nothing is listening on that port: the container is not running or uses another port | `docker compose ps` and `docker compose port postgres 5432` |
| An assertion failure in one test | A real behavior difference | Read the first failing test; run only it: `npx vitest run tests/http/consume.test.ts` |

Passing tests do **not** prove that the Docker images, the browser page or the load tests work. Those are separate checks.

### 5.5 Docker build and startup verification

```bash
docker compose build               # builds both images; no errors expected
docker compose up --build -d
docker compose ps                  # postgres, service, client: healthy
```

### 5.6 Load-test rehearsal (optional)

Performance tests are separate from normal use. Details and results: [performance.md](performance.md).

```bash
DURATION=10s VUS=10 bash scripts/load.sh hot-account check
```

Usage is `bash scripts/load.sh <scenario> [label]`, with scenarios `many-accounts`, `hot-account`, `retry-storm`,
`tight-limit` and `noisy-neighbor`. It needs Docker, internet access the first time (to pull the k6 image),
and `npm install` (it runs a consistency check with `npx tsx`). It restarts PostgreSQL and the service with extra
performance settings, runs k6 in Docker, then checks the database. Success shows a k6 summary, then:

```text
Consistency check passed: counters, user totals and accepted requests all agree.
...
OK: thresholds passed and the database totals are consistent.
```

If it prints `CONSISTENCY PROBLEMS`, that is a real finding: report it. Results are written to `load-tests/results/`.
Afterwards return to the normal configuration with `docker compose up --build -d`. Do not run load tests against a
service you care about: they create many `load-*` accounts.

---

## 6. Test the API manually

These steps use only `curl`. Run them in order, in one terminal session, with the stack running. They create
two new accounts and do not depend on earlier data. They have been written from the source code; run them once and
compare with the "expect" lines.

Set up variables:

```bash
BASE=http://localhost:3000                  # your SERVICE_PORT
ADMIN_TOKEN=dev-admin-token-change-me       # or the ADMIN_TOKEN value from your .env
RUN=$(date +%s)                             # makes request ids unique, so you can repeat the guide
BASIC=00000000-0000-4000-8000-000000000003  # predefined plan ids (fixed)
PREMIUM=00000000-0000-4000-8000-000000000004
api() { curl -s -w "\nHTTP %{http_code}\n" "$@"; }   # prints the body and the HTTP status
```

### 6.1 Create an account (admin token)

Creating an account needs the **admin token** in `X-Admin-Token`. Every other call uses the account's **API key** in `X-API-Key`.

```bash
KEY=$(curl -s -X POST $BASE/accounts \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Guide account"}' | sed -E 's/.*"apiKey":"([^"]+)".*/\1/')
echo "$KEY"
```

Expect: a key like `mk_1a2b3c4d_...`. It is shown only once and cannot be recovered later. If you see a long JSON text
instead, the account was not created: read the `error` in it (usually an admin token mismatch).

The full response (shortened) is:

```json
{"account":{"id":"...","name":"Guide account","createdAt":"...","plan":{"id":"...","name":"Starter","scope":"account","predefined":true,"rules":[{"kind":"max_per_request","limit":100},{"kind":"monthly_allowance","limit":10000}]}},"apiKey":"mk_..."}
```

New accounts start on the **Starter** plan.

### 6.2 Register two users

```bash
api -X POST $BASE/users -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"externalId":"alice"}'
api -X POST $BASE/users -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"externalId\":\"bob\",\"planId\":\"$PREMIUM\"}"
```

Expect: `HTTP 201` for both. Alice is on **Basic** (the default for new users), Bob on **Premium**.

### 6.3 An accepted request

```bash
api -X POST $BASE/consume -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"userId\":\"alice\",\"requestId\":\"guide-$RUN-1\",\"units\":10}"
```

Expect `HTTP 200` and (shortened):

```json
{"requestId":"guide-...-1","userId":"alice","units":10,"accepted":true,"reason":null,"replayed":false,
 "plans":{"account":{"name":"Starter"},"user":{"name":"Basic"}},
 "remaining":{"account":{"monthlyAllowance":9990,"dailyAllowance":null,"maxPerRequest":100},
              "user":{"monthlyAllowance":990,"dailyAllowance":null,"maxPerRequest":20}},"decidedAt":"..."}
```

In plain words: accepted; alice has 990 left this month and the account has 9990. `null` means the plan has no rule of that kind.
(`userId` here is the same identifier you registered as `externalId`.)

### 6.4 Retry the same request (idempotency)

Send exactly the same request again:

```bash
api -X POST $BASE/consume -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"userId\":\"alice\",\"requestId\":\"guide-$RUN-1\",\"units\":10}"
```

Expect `HTTP 200`, `"accepted":true` and **`"replayed":true`**, with the same numbers as before. The units are not counted twice.

Now reuse the id with a **different** amount:

```bash
api -X POST $BASE/consume -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"userId\":\"alice\",\"requestId\":\"guide-$RUN-1\",\"units\":11}"
```

Expect `HTTP 409` with `"code":"idempotency_conflict"`. A request id belongs to one exact request.

### 6.5 A rejection by a user-level limit

```bash
api -X POST $BASE/consume -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"userId\":\"alice\",\"requestId\":\"guide-$RUN-2\",\"units\":25}"
```

Expect `HTTP 200` (a rejection is a normal answer) with `"accepted":false` and:

```json
"reason":{"primary":{"level":"user","rule":"max_per_request","limit":20,"used":null,"remaining":20,"requested":25},
          "violations":[{"level":"user","rule":"max_per_request","limit":20,"used":null,"remaining":20,"requested":25}]}
```

In plain words: Alice's Basic plan allows 20 per request. The account's Starter plan would have allowed up to 100, so the
**user** limit blocked it. Nothing was consumed.

### 6.6 Inspect usage

```bash
api $BASE/users/alice/usage -H "X-API-Key: $KEY"
api $BASE/usage -H "X-API-Key: $KEY"
```

Expect for Alice (shortened): `"consumed":{"month":10,"today":10}` and `"remaining":{"monthlyAllowance":990,...}`, plus an `account`
block with 10 consumed. It is **10**, not 20 (the replay) and not 35 (the rejection consumed nothing). Add `?month=2026-09`
to see another UTC month (a past month shows what was consumed, without "remaining").

### 6.7 Request history

```bash
api "$BASE/history?limit=5" -H "X-API-Key: $KEY"
api "$BASE/history?outcome=rejected" -H "X-API-Key: $KEY"
```

Expect newest first: the rejected `guide-...-2`, then the accepted `guide-...-1`. The replay and the 409 conflict are not
new entries. Each entry holds the decision exactly as it was made. `nextCursor` is `null` when there are no more pages; when
it is not, pass it as `&cursor=...`.

### 6.8 Switch a plan and inspect effective plans

```bash
api -X PUT $BASE/users/alice/plan -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"planId\":\"$PREMIUM\"}"
api $BASE/users/alice/effective-plans -H "X-API-Key: $KEY"
```

Expect: `HTTP 200`, and `effective-plans` shows the **account** plan (Starter) and the **user** plan (Premium) that apply together.

Now repeat the amount that was rejected, with a new request id:

```bash
api -X POST $BASE/consume -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"userId\":\"alice\",\"requestId\":\"guide-$RUN-3\",\"units\":25}"
api $BASE/users/alice/usage -H "X-API-Key: $KEY"
```

Expect `"accepted":true`, and the usage shows `"consumed":{"month":35,...}` and Premium's `monthlyAllowance` remaining `9965`.
The earlier 10 units were kept: switching plans does not reset usage.

### 6.9 A rejection by the shared account limit

This uses a second account whose account plan is tiny. Usage persists within a month, so a fresh account keeps the example exact.

```bash
KEY2=$(curl -s -X POST $BASE/accounts -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"Guide account 2"}' \
  | sed -E 's/.*"apiKey":"([^"]+)".*/\1/')

PLAN2=$(curl -s -X POST $BASE/plans -H "X-API-Key: $KEY2" -H "Content-Type: application/json" \
  -d '{"name":"Tiny account","scope":"account","rules":[{"kind":"monthly_allowance","limit":25},{"kind":"max_per_request","limit":100}]}' \
  | sed -E 's/.*"plan":\{"id":"([^"]+)".*/\1/')
echo "$PLAN2"

api -X PUT $BASE/account/plan -H "X-API-Key: $KEY2" -H "Content-Type: application/json" \
  -d "{\"planId\":\"$PLAN2\"}"
api -X POST $BASE/users -H "X-API-Key: $KEY2" -H "Content-Type: application/json" -d '{"externalId":"carol"}'
api -X POST $BASE/users -H "X-API-Key: $KEY2" -H "Content-Type: application/json" \
  -d "{\"externalId\":\"dave\",\"planId\":\"$PREMIUM\"}"
```

Expect `PLAN2` to print a UUID and the three calls to return `HTTP 200`, `201`, `201`. Then:

```bash
api -X POST $BASE/consume -H "X-API-Key: $KEY2" -H "Content-Type: application/json" \
  -d "{\"userId\":\"dave\",\"requestId\":\"guide-$RUN-4\",\"units\":20}"
api -X POST $BASE/consume -H "X-API-Key: $KEY2" -H "Content-Type: application/json" \
  -d "{\"userId\":\"carol\",\"requestId\":\"guide-$RUN-5\",\"units\":10}"
```

Expect Dave's request to be accepted (the account has 5 left), and Carol's to be **rejected** with:

```json
"primary":{"level":"account","rule":"monthly_allowance","limit":25,"used":20,"remaining":5,"requested":10}
```

In plain words: Carol is well within her own limits (1,000 for the month and 20 per request, and her `remaining.user.monthlyAllowance` is
still 1000), but the **account** has only 5 units left, and the account's allowance is shared by all its users.

### 6.10 Authentication, isolation and validation failures

```bash
api $BASE/account                                              # no API key
api $BASE/account -H "X-API-Key: not-a-real-key"               # wrong API key
api -X POST $BASE/accounts -H "Content-Type: application/json" -d '{"name":"x"}'   # no admin token
api $BASE/users/alice/usage -H "X-API-Key: $KEY2"              # another account's user
api -X POST $BASE/consume -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d "{\"userId\":\"alice\",\"requestId\":\"guide-$RUN-6\",\"units\":0}"             # invalid amount
```

| Call | Expect |
|---|---|
| no API key | `HTTP 401`, `"code":"missing_api_key"` |
| wrong API key | `HTTP 401`, `"code":"invalid_api_key"` |
| no admin token | `HTTP 401`, `"code":"admin_unauthorized"` |
| `KEY2` asking about alice (a user of the first account) | `HTTP 404`, `"code":"user_not_found"`. Exactly the answer for a user that does not exist, so nothing leaks between accounts |
| `units: 0` | `HTTP 400`, `"code":"validation_error"`, details `[{"path":"units","message":"units must be a positive whole number"}]` |

All errors have the shape `{"error":{"code":"...","message":"..."}}`. The full list of endpoints, bodies and codes is in the
[README API reference](../README.md#api-reference).

---

## 7. Data persistence and cleanup

All data (accounts, plans, usage, history) lives in the PostgreSQL volume `postgres-data` (Compose names it with your
project prefix, for example `usage-metering_postgres-data`; check with `docker volume ls`).

### 7.1 Verify that data survives a restart

Using `KEY` from section 6:

```bash
api $BASE/users/alice/usage -H "X-API-Key: $KEY"          # note the consumed units (35)
docker compose restart service
api $BASE/users/alice/usage -H "X-API-Key: $KEY"          # same numbers, same API key still works
docker compose down                                       # removes containers, KEEPS the data volume
docker compose up -d
api $BASE/users/alice/usage -H "X-API-Key: $KEY"          # still the same
```

After `up -d`, wait until `docker compose ps` shows `healthy` before the last call. The browser demo session is kept in the `client`
container's memory, so after a restart of that container the page asks you to create a new demo account; the data remains in the database.

### 7.2 Commands that keep data and commands that delete it

| Command | Effect on the database data |
|---|---|
| `docker compose stop` / `docker compose start` | **kept** |
| `docker compose restart service` | **kept** |
| `docker compose down` | **kept** (removes containers and the network only) |
| `docker compose up --build -d` | **kept** (rebuilds images, recreates containers) |
| `docker compose down -v` | **DELETED**: also removes the volume |
| `docker volume rm <project>_postgres-data` | **DELETED** |
| `docker volume prune`, `docker system prune --volumes` | **DELETED** (also affects other projects' unused volumes) |

> **Warning:** the last four rows permanently destroy all accounts, users, usage and history, and every API key stops working.
> Use them only when you intend to start from nothing.

### 7.3 Stop the application when finished

```bash
docker compose down
```

---

## 8. Troubleshooting

Problems marked *seen during development* happened while building this project on WSL2 with Docker Desktop.

### Containers do not become healthy

```bash
docker compose ps -a
docker compose logs --tail=100 postgres
docker compose logs --tail=100 service
docker compose logs --tail=100 client
```

- `postgres` unhealthy: read its log (a port, password or disk problem).
- `service` unhealthy or restarting: look for `Migration ... failed` or a connection error in its log. It waits for PostgreSQL, then migrates.
- `client` unhealthy: it starts only after the service is healthy. Fix the service first.

### Database migrations fail

The service applies the SQL migrations in `migrations/` at startup. A failure appears in `docker compose logs service`:

- `Migration 000X_name failed: ...` means that migration was rolled back completely and nothing was recorded. Read the SQL error after it.
- `... was already applied but its checksum changed` means an already-applied migration file was edited. Never edit an applied migration:
  restore the file with Git and add a **new** migration instead.

### A port is already in use

Symptoms: `port is already allocated` or `address already in use`. Find the owner and change your port:

```bash
ss -ltnp | grep -E ':(3000|8080|5432|5433)\b'
```

Then set `SERVICE_PORT`, `CLIENT_PORT` or `POSTGRES_PORT` in `.env` and run `docker compose up -d`. Inside Compose the containers always
use their normal ports; only the host side changes.

### `password authentication failed for user "metering"`

*Seen during development.* The credentials work inside the container but fail from your shell. Two causes:

1. **Another PostgreSQL is already listening on 5432** (for example one installed inside WSL). Check:
   `ss -ltnp | grep 5432` and `ps aux | grep [p]ostgres`. Fix: set `POSTGRES_PORT=5433` in `.env`, run `docker compose up -d postgres`, and use
   port 5433 in `TEST_DATABASE_URL`.
2. **The data volume was created with a different password** (Postgres reads `POSTGRES_PASSWORD` only when it first creates the volume).
   Confirm with
   `docker compose exec -e PGPASSWORD=metering_dev_password postgres psql -h 127.0.0.1 -U metering -d metering -c "select 1"`.
   If that also fails, the volume holds an old password. Resetting it deletes the data (`docker compose down -v`, see the warning in 7.2).

### `ECONNREFUSED 127.0.0.1:5433` (tests or scripts)

*Seen during development.* Nothing listens on that port: the container is not running, or it is published on another port. Check
`docker compose ps` and `docker compose port postgres 5432`, and make `TEST_DATABASE_URL` and `.env` agree.
A new terminal does not inherit an `export`; add it to `~/.bashrc`.

### Docker is not available in WSL

*Seen during development.* `The command 'docker' could not be found in this WSL 2 distro`: start Docker Desktop, then enable
Settings > Resources > WSL Integration for your distribution, and run `docker --version` again. If it still fails, run `wsl --shutdown`
from Windows PowerShell and reopen the terminal.

### The client cannot reach the service

Symptoms: the page shows `Error: network: ...` or `Error: ...`, or `docker compose logs client` shows connection errors.

```bash
docker compose ps
curl -s http://localhost:3000/ready
docker compose logs --tail=100 service
```

Inside Compose the client calls `http://service:3000`, not `localhost`. If the service is unhealthy or restarting, fix that first.

### Authentication errors

| Code | Meaning | What to check |
|---|---|---|
| `missing_api_key` (401) | No `X-API-Key` header | Add the header |
| `invalid_api_key` (401) | Key is wrong or revoked | Keys are shown only once at creation; create a new account if lost |
| `admin_unauthorized` (401) | Wrong or missing `X-Admin-Token` | Use the `ADMIN_TOKEN` from your `.env`, or `dev-admin-token-change-me` if unset. The `service` and the `client` containers must have the same value |
| `user_not_found` (404) | The user is not in **your** account | Register the user first; another account's users are never visible |

### A request was rejected by a limit

This is normal behavior, not a fault. Read `reason.primary`: `level` is `account` or `user`; `rule` is `max_per_request`, `monthly_allowance` or `daily_allowance`;
`remaining` is what that rule would still allow. Common causes:

- Over a user plan's per-request limit (Basic allows 20; Premium 200).
- The account's shared allowance is nearly used up even though the user has room (see 4.4 step 6 and 6.9).
- An allowance was lowered below existing usage: remaining shows 0 until it is raised.
- A retry with the same request id replays the **original** answer, even a rejection. Use a new request id to be evaluated again.

### The browser demo shows unexpected results

- Numbers differ from this guide: another action changed the account. Click **New demo account** for a clean state.
- "No demo account yet. Create one first.": the demo session was lost (the `client` container restarted). Click **New demo account**.
- Bob is rejected at 60 pages even though Premium allows 200: the demo account plan caps each request at 50 (4.2).
- `Error: ...` in red text or `FAILED: ...`: a technical problem. Check `docker compose logs --tail=100 client service`.

### Build problems

- `npm ci` complains that `package.json` and the lockfile differ: run `npm install` locally, commit the lockfile, rebuild.
- `error TS5033 ... EACCES` when running `npm run build`: *seen during development.* `dist/` is owned by root (usually from an earlier `sudo`
  build). Check `ls -ld dist`, then `sudo chown -R "$USER":"$USER" dist` (or remove the generated directory and rebuild). Avoid `sudo npm run build`.

### Load tests cannot run

- `docker` problems: see the WSL section above.
- k6 image cannot be pulled: check internet access; the image is `grafana/k6`.
- `No accounts named "load-*" found`: the k6 run created nothing (k6 failed earlier); read the k6 output above it.
- `Unknown scenario`: use one of `many-accounts hot-account retry-storm tight-limit noisy-neighbor`.
- Missing `tsx` or modules: run `npm install`.
- Permission error writing `load-tests/results`: create it yourself with `mkdir -p load-tests/results`.

---

## 9. Final verification checklist

From a fresh clone:

**Automated (copy and run)**

- [ ] `cp .env.example .env` (set `POSTGRES_PORT=5433` if 5432 is busy)
- [ ] `docker compose up --build -d`
- [ ] `docker compose ps` shows `postgres`, `service` and `client` as healthy
- [ ] `curl -s http://localhost:3000/ready` returns `{"status":"ready"}`
- [ ] `bash scripts/smoke.sh` ends with `OK: every scenario step behaved as expected.`
- [ ] `npm install`, then `npm run format:check && npm run lint && npm run typecheck`
- [ ] `npm test` ends with all test files passed (needs `TEST_DATABASE_URL`)
- [ ] `docker compose restart service`, then the same usage numbers and the same API key still work

**Manual (look and compare)**

- [ ] http://localhost:8080 loads
- [ ] **Run guided scenario**: 8 steps, all **OK**, the table shows account 75 used / 25 left, alice 35, bob 40 (4.4)
- [ ] **New demo account**, then alice 25 pages is rejected by the user per-request limit (4.5)
- [ ] Switch alice to Premium, process 25 pages: accepted, alice left 9975, account left 75
- [ ] Switch alice back to Basic: used stays 25, left 975 (4.6)
- [ ] The API steps in section 6 give the "expect" results, including `replayed:true`, the 409, both rejection types, and the 401/404/400 failures

**Optional:** `DURATION=10s VUS=10 bash scripts/load.sh hot-account check` ends with `OK`.

---

## 10. Verification status

"Reported by owner" means the project owner said it passed; the individual outputs were not supplied. "Expected from source"
means it is derived from the code and has **not** been run. Nothing here was run by the author of this guide.

| Check | Evidence | Status |
|---|---|---|
| Automated tests: 27 files, 199 tests | Owner's pasted result after the performance step | Reported by owner (re-run after later changes) |
| `format`, `lint`, `typecheck` clean | Owner's pasted output during the client milestone | Reported by owner at that point; re-run after the performance and documentation changes |
| Compose stack healthy, `bash scripts/smoke.sh`, browser demo, manual API checks, restart persistence, logs, load rehearsal | Owner replied "all pass" to the verification checklist | Reported by owner (no individual outputs supplied) |
| Exact texts and numbers quoted in section 4 | Derived from `client/web/page.ts`, `client/documents.ts`, `client/scenario.ts` and the end-to-end test | Expected from source |
| The curl sequence in section 6 | Written from the route handlers; never executed | Expected from source |
| Lint rule that keeps `src/domain` pure | Added in the documentation milestone; proof not reported | Not verified |
| Fresh-clone start-up | Not reported | Not verified |
| Performance numbers | Not supplied (see [performance.md](performance.md)) | Not verified |
| Accuracy of `docs/endpoints.md` | Not compared with the code | Not verified (this guide links to the README API reference instead) |
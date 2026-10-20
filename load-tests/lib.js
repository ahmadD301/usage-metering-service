import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || "dev-admin-token-change-me";
const JSON_HEADERS = { "Content-Type": "application/json" };

/** The largest allowance the API accepts: "effectively unlimited" for throughput tests. */
export const HUGE = 1000000000000;

export const unexpectedRejections = new Counter("unexpected_rejections");
export const acceptedUnits = new Counter("accepted_units");
export const duplicateViolations = new Counter("duplicate_violations");

export const intFromEnv = (name, fallback) => {
  const raw = __ENV[name];
  return raw === undefined || raw === "" ? fallback : Number(raw);
};

export const newRunId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---------- setup helpers (run once, before the load starts) ----------

function send(method, path, body, headers) {
  return http.request(method, `${BASE_URL}${path}`, JSON.stringify(body), {
    headers: Object.assign({}, JSON_HEADERS, headers),
    tags: { name: "setup" },
  });
}

function mustSucceed(response, what) {
  if (response.status < 200 || response.status >= 300) {
    fail(`${what} failed: HTTP ${response.status} ${response.body}`);
  }
  return response.json();
}

/**
 * Creates an account with a custom account plan and a custom user plan, and `users` users.
 * Returns what the load script needs: the API key and the user ids (u0, u1, ...).
 */
export function setupAccount(options) {
  const created = mustSucceed(
    send("POST", "/accounts", { name: options.label }, { "X-Admin-Token": ADMIN_TOKEN }),
    "create account",
  );
  const keyHeaders = { "X-API-Key": created.apiKey };

  const accountPlan = mustSucceed(
    send(
      "POST",
      "/plans",
      {
        name: "load account plan",
        scope: "account",
        rules: [
          { kind: "monthly_allowance", limit: options.accountMonthly },
          { kind: "max_per_request", limit: options.perRequest },
        ],
      },
      keyHeaders,
    ),
    "create account plan",
  );
  mustSucceed(
    send("PUT", "/account/plan", { planId: accountPlan.plan.id }, keyHeaders),
    "assign account plan",
  );

  const userPlan = mustSucceed(
    send(
      "POST",
      "/plans",
      {
        name: "load user plan",
        scope: "user",
        rules: [
          { kind: "monthly_allowance", limit: options.userMonthly },
          { kind: "max_per_request", limit: options.perRequest },
        ],
      },
      keyHeaders,
    ),
    "create user plan",
  );

  const userIds = [];
  for (let i = 0; i < options.users; i += 1) {
    userIds.push(`u${i}`);
  }
  for (let start = 0; start < userIds.length; start += 25) {
    const batch = userIds.slice(start, start + 25).map((externalId) => [
      "POST",
      `${BASE_URL}/users`,
      JSON.stringify({ externalId, planId: userPlan.plan.id }),
      { headers: Object.assign({}, JSON_HEADERS, keyHeaders), tags: { name: "setup" } },
    ]);
    http.batch(batch).forEach((response) => {
      if (response.status !== 201) {
        fail(`create user failed: HTTP ${response.status} ${response.body}`);
      }
    });
  }

  return { id: created.account.id, apiKey: created.apiKey, label: options.label, users: userIds };
}

// ---------- the request under test ----------

function consumeParams(account, extraTags) {
  return {
    headers: Object.assign({}, JSON_HEADERS, { "X-API-Key": account.apiKey }),
    tags: Object.assign({ name: "consume" }, extraTags || {}),
  };
}

export function consume(account, userId, requestId, units, extraTags) {
  return http.post(
    `${BASE_URL}/consume`,
    JSON.stringify({ userId, requestId, units }),
    consumeParams(account, extraTags),
  );
}

/** The same request as a tuple for http.batch. */
export function consumeEntry(account, userId, requestId, units, extraTags) {
  return [
    "POST",
    `${BASE_URL}/consume`,
    JSON.stringify({ userId, requestId, units }),
    consumeParams(account, extraTags),
  ];
}

/** Checks for HTTP 200 and returns the parsed decision, or null if the call failed. */
export function decisionOf(response) {
  const ok = check(response, { "consume returned 200": (r) => r.status === 200 });
  return ok ? response.json() : null;
}

/** For scenarios where every request should be accepted (limits are huge). */
export function expectAccepted(response) {
  const decision = decisionOf(response);
  if (decision === null) {
    return null;
  }
  if (decision.accepted) {
    acceptedUnits.add(decision.units);
  } else {
    unexpectedRejections.add(1);
  }
  return decision;
}

// ---------- thresholds and summary ----------

export const TREND_STATS = ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"];

/**
 * Real gates: no HTTP errors and no unexpected rejections. The `max>=0` / `count>=0` entries
 * can never fail: k6 only reports a sub-metric (a metric filtered by tag) if a threshold
 * mentions it. P95_MS adds an optional latency gate.
 */
export function reportOnlyThresholds(extra) {
  const thresholds = {
    http_req_failed: ["rate<0.001"],
    unexpected_rejections: ["count==0"],
    "http_req_duration{name:consume}": ["max>=0"],
    "http_reqs{name:consume}": ["count>=0"],
  };
  if (__ENV.P95_MS) {
    thresholds["http_req_duration{name:consume}"] = ["max>=0", `p(95)<${__ENV.P95_MS}`];
  }
  return Object.assign(thresholds, extra || {});
}

const round1 = (n) => (n === undefined || n === null ? null : Math.round(n * 10) / 10);

const seconds = (text) => {
  const match = /^(\d+)(s|m)$/.exec(text || "");
  return match ? Number(match[1]) * (match[2] === "m" ? 60 : 1) : null;
};

const valueOf = (data, metric, stat) => {
  const m = data.metrics[metric];
  return m && m.values && m.values[stat] !== undefined ? m.values[stat] : null;
};

function latencyOf(data, metric) {
  const m = data.metrics[metric];
  if (!m || !m.values) {
    return null;
  }
  const v = m.values;
  return {
    avg: round1(v.avg),
    p50: round1(v.med),
    p90: round1(v["p(90)"]),
    p95: round1(v["p(95)"]),
    p99: round1(v["p(99)"]),
    max: round1(v.max),
  };
}

const CONFIG_KEYS = [
  "VUS",
  "DURATION",
  "USERS",
  "ACCOUNTS",
  "DUPES",
  "HOT_VUS",
  "QUIET_RATE",
  "QUIET_ACCOUNTS",
  "ACCOUNT_MONTHLY",
];

export function summarize(data, scenario, workloads) {
  const durationSeconds = seconds(__ENV.DURATION);
  const count = valueOf(data, "http_reqs{name:consume}", "count");
  const config = {};
  CONFIG_KEYS.forEach((key) => {
    if (__ENV[key]) {
      config[key] = __ENV[key];
    }
  });
  const byWorkload = {};
  (workloads || []).forEach((workload) => {
    byWorkload[workload] = latencyOf(data, `http_req_duration{workload:${workload}}`);
  });
  const droppedIterations = valueOf(data, "dropped_iterations", "count");
  return {
    scenario,
    resultName: __ENV.RESULT_NAME || scenario,
    config,
    consume: {
      requests: count,
      perSecond: count !== null && durationSeconds !== null ? round1(count / durationSeconds) : null,
      latencyMs: latencyOf(data, "http_req_duration{name:consume}"),
    },
    latencyMsByWorkload: byWorkload,
    droppedIterations: droppedIterations === null ? 0 : droppedIterations,
    httpFailedRate: valueOf(data, "http_req_failed", "rate"),
    checksFailed: valueOf(data, "checks", "fails"),
    unexpectedRejections: valueOf(data, "unexpected_rejections", "count"),
    acceptedUnits: valueOf(data, "accepted_units", "count"),
    duplicateViolations: valueOf(data, "duplicate_violations", "count"),
  };
}

const show = (value) => (value === null || value === undefined ? "n/a" : String(value));

const latencyLine = (latency) =>
  latency === null
    ? "n/a"
    : `avg ${show(latency.avg)} | p50 ${show(latency.p50)} | p90 ${show(latency.p90)} | ` +
      `p95 ${show(latency.p95)} | p99 ${show(latency.p99)} | max ${show(latency.max)}`;

export function formatSummary(summary) {
  const lines = [
    "",
    `=== ${summary.resultName} (${summary.scenario}) ===`,
    `config:        ${JSON.stringify(summary.config)}`,
    `consume calls: ${show(summary.consume.requests)}  (~${show(summary.consume.perSecond)} req/s over the configured duration)`,
    `latency (ms):  ${latencyLine(summary.consume.latencyMs)}`,
  ];
  Object.keys(summary.latencyMsByWorkload).forEach((workload) => {
    lines.push(`  ${workload.padEnd(12)} ${latencyLine(summary.latencyMsByWorkload[workload])}`);
  });
  lines.push(
    `http failed:   ${show(summary.httpFailedRate)}   checks failed: ${show(summary.checksFailed)}`,
    `accepted units: ${show(summary.acceptedUnits)}   unexpected rejections: ${show(summary.unexpectedRejections)}`,
    `duplicate violations: ${show(summary.duplicateViolations)}   dropped iterations: ${show(summary.droppedIterations)}`,
    "",
  );
  return lines.join("\n");
}

/** Use as: export const handleSummary = makeHandleSummary("hot-account"); */
export function makeHandleSummary(scenario, workloads) {
  return function handleSummary(data) {
    const summary = summarize(data, scenario, workloads);
    const resultsDir = __ENV.RESULTS_DIR || "/results";
    const output = { stdout: formatSummary(summary) };
    output[`${resultsDir}/${summary.resultName}.json`] = JSON.stringify(summary, null, 2);
    return output;
  };
}
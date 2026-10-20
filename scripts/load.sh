#!/usr/bin/env bash
# Usage: bash scripts/load.sh <scenario> [label]
# Scenarios: many-accounts hot-account retry-storm tight-limit noisy-neighbor
# Knobs (environment): VUS DURATION USERS ACCOUNTS DUPES HOT_VUS QUIET_RATE QUIET_ACCOUNTS
#                      ACCOUNT_MONTHLY P95_MS PG_SYNCHRONOUS_COMMIT
set -euo pipefail

SCENARIO="${1:?Usage: bash scripts/load.sh <scenario> [label]}"
LABEL="${2:-run}"

case "${SCENARIO}" in
  many-accounts | hot-account | retry-storm | tight-limit | noisy-neighbor) ;;
  *)
    echo "Unknown scenario: ${SCENARIO}"
    echo "Choose one of: many-accounts hot-account retry-storm tight-limit noisy-neighbor"
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export COMPOSE_FILE="docker-compose.yml:docker-compose.perf.yml"
LOCAL_UID="$(id -u)"
LOCAL_GID="$(id -g)"
export LOCAL_UID LOCAL_GID
RESULT_NAME="${LABEL}-${SCENARIO}"
mkdir -p load-tests/results

echo "==> Starting postgres and the service (rebuilding the service image)"
docker compose up -d --build --wait postgres service

PSQL=(docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-metering}" -d "${POSTGRES_DB:-metering}")
if ! "${PSQL[@]}" -q -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" -c "SELECT pg_stat_statements_reset()" >/dev/null; then
  echo "warning: pg_stat_statements is not available, so the statement report will be empty"
fi

ENV_ARGS=(-e "RESULT_NAME=${RESULT_NAME}")
for var in VUS DURATION USERS ACCOUNTS DUPES HOT_VUS QUIET_RATE QUIET_ACCOUNTS ACCOUNT_MONTHLY P95_MS; do
  if [[ -n "${!var:-}" ]]; then
    ENV_ARGS+=(-e "${var}=${!var}")
  fi
done

SINCE="$(date -u -d '-60 seconds' +%Y-%m-%dT%H:%M:%SZ)"

echo "==> Running k6 scenario: ${SCENARIO} (${RESULT_NAME})"
K6_STATUS=0
docker compose run --rm "${ENV_ARGS[@]}" k6 run "/scripts/${SCENARIO}.js" || K6_STATUS=$?

echo "==> Checking database consistency"
DATABASE_URL="postgres://${POSTGRES_USER:-metering}:${POSTGRES_PASSWORD:-metering_dev_password}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-metering}"
export DATABASE_URL
VERIFY_ARGS=(--prefix "load-" --since "${SINCE}")
if [[ "${SCENARIO}" == "tight-limit" ]]; then
  VERIFY_ARGS+=(--expect-saturated)
fi
VERIFY_STATUS=0
npx tsx load-tests/verify.ts "${VERIFY_ARGS[@]}" || VERIFY_STATUS=$?

echo "==> Heaviest SQL statements during this run"
"${PSQL[@]}" -c "SELECT calls, round(total_exec_time::numeric, 0) AS total_ms, round(mean_exec_time::numeric, 3) AS mean_ms, left(regexp_replace(query, '\s+', ' ', 'g'), 90) AS query FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) ORDER BY total_exec_time DESC LIMIT 10" \
  | tee "load-tests/results/${RESULT_NAME}.statements.txt" || true

echo
echo "Summary file:  load-tests/results/${RESULT_NAME}.json"
if [[ ${K6_STATUS} -ne 0 || ${VERIFY_STATUS} -ne 0 ]]; then
  echo "FAILED (k6 exit ${K6_STATUS}, verify exit ${VERIFY_STATUS})"
  exit 1
fi
echo "OK: thresholds passed and the database totals are consistent."
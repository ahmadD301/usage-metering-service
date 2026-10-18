#!/usr/bin/env bash
# Smoke test for the full Docker Compose stack. Usage: bash scripts/smoke.sh
set -euo pipefail

CLIENT_URL="${CLIENT_URL:-http://localhost:8080}"
SERVICE_URL="${SERVICE_URL:-http://localhost:3000}"

echo "Waiting for the demo client at ${CLIENT_URL} ..."
for _ in $(seq 1 30); do
  if curl -fsS "${CLIENT_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS "${CLIENT_URL}/health" >/dev/null

echo "Checking the metering service readiness ..."
curl -fsS "${SERVICE_URL}/ready"
echo

echo "Running the scenario through the demo client ..."
response="$(curl -fsS -X POST "${CLIENT_URL}/api/scenario")"

if echo "${response}" | grep -q '"allPassed":true'; then
  echo "OK: every scenario step behaved as expected."
else
  echo "FAILED. Response:"
  echo "${response}"
  exit 1
fi
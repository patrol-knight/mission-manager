#!/bin/sh
# Builds and starts the stack, then checks each service serves. Own compose
# project, so your usual stack is untouched; needs ports 8000 and 5050 free.
set -eu
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME=mission-manager-smoke
export API_BASE_URL=http://smoke.test:8000

cleanup() {
  status=$?
  [ "$status" -ne 0 ] && docker compose logs --no-color backend frontend
  docker compose down --volumes --remove-orphans
  exit "$status"
}
trap cleanup EXIT

docker compose up --build --detach --wait

get() { curl -fsS --retry 30 --retry-connrefused --retry-delay 1 "$1"; }
get http://localhost:8000/api/system/status > /dev/null
get http://localhost:8000/api/map/bounds > /dev/null  # 503 if the map didn't load
get http://localhost:8000/api/missions/current > /dev/null
get http://localhost:5050/ | grep -q 'id="root"'
get http://localhost:5050/config.js | grep -q "$API_BASE_URL"  # envsubst ran
echo "Smoke test passed"

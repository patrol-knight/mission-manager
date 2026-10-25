#!/bin/sh
# The checks CI runs; usage in scripts/README.md.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -z "${PYTHON:-}" ]; then
  if [ -x "$root/backend/.venv/bin/python" ]; then PYTHON="$root/backend/.venv/bin/python"; else PYTHON=python3; fi
fi

gen_api() {
  tmp=$(mktemp -d)
  "$PYTHON" "$root/backend/tools/export_openapi.py" > "$tmp/openapi.json"
  (cd "$root/frontend" && npx openapi-typescript "$tmp/openapi.json" --default-non-nullable false -o "$1" > /dev/null)
  rm -rf "$tmp"
}

check_backend() {
  cd "$root/backend"
  "$PYTHON" -m ruff check .
  "$PYTHON" -m pytest -q
}

check_frontend() {
  cd "$root/frontend"
  npm run lint
  npm test
  npm run build
}

check_contract() {
  out=$(mktemp -d)
  gen_api "$out/schema.ts"
  if ! diff -u "$root/frontend/src/api/schema.ts" "$out/schema.ts"; then
    echo "frontend/src/api/schema.ts is out of date: run scripts/check.sh gen-api and commit it." >&2
    exit 1
  fi
  rm -rf "$out"
  echo "API types are up to date"
}

check_docker() (
  # Own compose project: your usual stack's containers and volumes are untouched.
  cd "$root"
  export COMPOSE_PROJECT_NAME=mission-manager-smoke API_BASE_URL=http://smoke.test:8000
  trap 'status=$?; [ "$status" -ne 0 ] && docker compose logs --no-color backend frontend; docker compose down --volumes --remove-orphans' EXIT
  docker compose up --build --detach --wait
  get() { curl -fsS --retry 30 --retry-connrefused --retry-delay 1 "$1"; }
  get http://localhost:8000/api/system/status > /dev/null
  get http://localhost:8000/api/map/bounds > /dev/null  # 503 if the map didn't load
  get http://localhost:8000/api/missions/current > /dev/null
  get http://localhost:5050/ | grep -q 'id="root"'
  get http://localhost:5050/config.js | grep -q "$API_BASE_URL"  # envsubst ran
  echo "Smoke test passed"
)

[ $# -eq 0 ] && set -- backend frontend contract
[ "$*" = all ] && set -- backend frontend contract docker

for check in "$@"; do
  case $check in
    gen-api) gen_api "$root/frontend/src/api/schema.ts"; echo "Wrote frontend/src/api/schema.ts"; continue ;;
    backend | frontend | contract | docker) ;;
    *) echo "Unknown check: $check (see scripts/README.md)" >&2; exit 2 ;;
  esac
  printf '\n==> %s\n' "$check"
  "check_$check"
done

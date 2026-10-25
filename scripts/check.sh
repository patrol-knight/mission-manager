#!/bin/sh
# Everything CI runs. --docker adds the image smoke test.
set -eu
scripts=$(cd "$(dirname "$0")" && pwd)

step() { printf '\n==> %s\n' "$1"; }

step "Backend";  "$scripts/check-backend.sh"
step "Frontend"; "$scripts/check-frontend.sh"
step "Contract"; "$scripts/check-contract.sh"
if [ "${1:-}" = "--docker" ]; then
  step "Docker smoke test"; "$scripts/docker-smoke.sh"
fi
printf '\nAll checks passed\n'

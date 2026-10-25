#!/bin/sh
# Ruff and pytest, as in CI. Needs backend/requirements-dev.txt installed.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
. "$root/scripts/python.sh"
cd "$root/backend"
"$PYTHON" -m ruff check .
"$PYTHON" -m pytest -q

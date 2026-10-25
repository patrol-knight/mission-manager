#!/bin/sh
# Regenerates frontend/src/api/schema.ts (or the given file) from the backend's OpenAPI.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
. "$root/scripts/python.sh"
out=${1:-$root/frontend/src/api/schema.ts}
case $out in /*) ;; *) out=$PWD/$out ;; esac
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
"$PYTHON" "$root/backend/tools/export_openapi.py" > "$tmp/openapi.json"
cd "$root/frontend"
npx openapi-typescript "$tmp/openapi.json" --default-non-nullable false -o "$out" > /dev/null

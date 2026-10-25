#!/bin/sh
# Fails if frontend/src/api/schema.ts is out of date with the backend's API.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
"$root/scripts/gen-api-types.sh" "$tmp/schema.ts"
if ! diff -u "$root/frontend/src/api/schema.ts" "$tmp/schema.ts"; then
  echo "frontend/src/api/schema.ts is out of date: run scripts/gen-api-types.sh and commit it." >&2
  exit 1
fi
echo "API types are up to date"

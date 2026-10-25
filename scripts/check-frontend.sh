#!/bin/sh
# Lint, unit tests, type-check and build, as in CI. Needs `npm ci` done.
set -eu
cd "$(dirname "$0")/../frontend"
npm run lint
npm test
npm run build

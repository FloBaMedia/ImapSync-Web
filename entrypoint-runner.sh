#!/bin/sh
set -e

cd /app

fail() { echo "$1" >&2; exit 1; }

[ -n "$DATABASE_URL" ]            || fail "FATAL: DATABASE_URL is not set."
[ -n "$ENCRYPTION_KEY" ]          || fail "FATAL: ENCRYPTION_KEY is not set (must match the app container)."
[ ${#ENCRYPTION_KEY} -ge 64 ]     || fail "FATAL: ENCRYPTION_KEY must be 64 hex characters (32 bytes)."

echo "Starting imapsync runner..."
exec node_modules/.bin/tsx /app/scripts/runner.mjs

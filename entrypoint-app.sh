#!/bin/sh
set -e

cd /app

fail() { echo "$1" >&2; exit 1; }

[ -n "$DATABASE_URL" ]                 || fail "FATAL: DATABASE_URL is not set."
[ -n "$JWT_SECRET" ]                   || fail "FATAL: JWT_SECRET is not set (run: openssl rand -base64 32)."
[ ${#JWT_SECRET} -ge 32 ]              || fail "FATAL: JWT_SECRET must be at least 32 characters."
[ -n "$ENCRYPTION_KEY" ]               || fail "FATAL: ENCRYPTION_KEY is not set (run: openssl rand -hex 32)."
[ ${#ENCRYPTION_KEY} -ge 64 ]          || fail "FATAL: ENCRYPTION_KEY must be 64 hex characters (32 bytes)."

echo "Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "Initializing database..."
node_modules/.bin/tsx /app/scripts/init.mjs

echo "Starting application..."
exec node server.js

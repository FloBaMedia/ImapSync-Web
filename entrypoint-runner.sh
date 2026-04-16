#!/bin/sh
set -e

cd /app

if [ -z "$DATABASE_URL" ]; then
  echo "❌  DATABASE_URL is not set. Aborting."
  exit 1
fi

echo "🏃  Starting imapsync runner..."
exec node_modules/.bin/tsx /app/scripts/runner.mjs

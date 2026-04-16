#!/bin/sh
set -e

cd /app

if [ -z "$DATABASE_URL" ]; then
  echo "❌  DATABASE_URL is not set. Aborting."
  echo "    Set it in your environment / Coolify Environment Variables."
  exit 1
fi

echo "🗄️  Running database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "🌱  Initializing database..."
node_modules/.bin/tsx /app/scripts/init.mjs

echo "🚀  Starting application..."
exec node server.js
